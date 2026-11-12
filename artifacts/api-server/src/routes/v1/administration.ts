import { Router } from "express";
import { and, asc, count, desc, eq, inArray, not, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import * as Contract from "@workspace/api-zod";
import {
  assistanceRequestsTable,
  auditLogsTable,
  donorInventoryTable,
  notificationsTable,
  reportsTable,
  requireDb,
  schoolsTable,
  teacherProfilesTable,
  usersTable,
  userSessionsTable,
  verificationDocumentsTable,
  verificationRecordsTable,
} from "@workspace/db";
import { requireAuth, requireRole } from "../../lib/auth-middleware";
import { HttpError } from "../../lib/errors";
import { publicUser } from "../../lib/security";
import { verificationRecordView, verifiedTeacherIds } from "../../lib/verification";
import { documentInfo } from "./verification";
import { toPublicRequest } from "./assistance";
import type { AuthenticatedPrincipal } from "../../types/auth";
import { parseBody, responseDate } from "./shared";

const router = Router();

function toPrincipal(user: {
  id: string;
  name: string;
  email: string;
  role: AuthenticatedPrincipal["role"];
  status: AuthenticatedPrincipal["status"];
  emailVerifiedAt: Date | null;
}): AuthenticatedPrincipal {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    emailVerifiedAt: user.emailVerifiedAt,
  };
}

router.get(
  "/admin/users",
  requireAuth,
  requireRole("ADMIN"),
  async (_request, response) => {
    const rows = await requireDb()
      .select({
        id: usersTable.id,
        name: usersTable.name,
        email: usersTable.email,
        role: usersTable.role,
        status: usersTable.status,
        emailVerifiedAt: usersTable.emailVerifiedAt,
      })
      .from(usersTable)
      .orderBy(desc(usersTable.createdAt))
      .limit(500);
    response.json(
      Contract.ListAdminUsersResponse.parse(
        rows.map((row) => publicUser(toPrincipal(row))),
      ),
    );
  },
);

router.patch(
  "/admin/users/:id/status",
  requireAuth,
  requireRole("ADMIN"),
  async (request, response) => {
    const params = Contract.AdminUpdateUserStatusParams.safeParse(request.params);
    const input = parseBody(
      Contract.AdminUpdateUserStatusBody,
      request.body,
      response,
    );
    if (!params.success) {
      response.status(400).json({ error: "The account id is not valid." });
      return;
    }
    if (!input) return;
    if (
      request.authUser!.id === params.data.id &&
      input.status === "SUSPENDED"
    ) {
      throw new HttpError(400, "You cannot suspend your own administrator account.");
    }
    const database = requireDb();
    const [target] = await database
      .select({
        id: usersTable.id,
        role: usersTable.role,
        emailVerifiedAt: usersTable.emailVerifiedAt,
      })
      .from(usersTable)
      .where(eq(usersTable.id, params.data.id))
      .limit(1);
    if (!target) throw new HttpError(404, "The account was not found.");
    if (input.status === "ACTIVE" && !target.emailVerifiedAt) {
      throw new HttpError(409, "An account must verify its email before activation.");
    }
    if (target.role === "ADMIN" && input.status === "SUSPENDED") {
      const [{ activeAdmins }] = await database
        .select({ activeAdmins: count() })
        .from(usersTable)
        .where(
          and(
            eq(usersTable.role, "ADMIN"),
            eq(usersTable.status, "ACTIVE"),
            not(eq(usersTable.id, target.id)),
          ),
        );
      if (activeAdmins === 0) {
        throw new HttpError(409, "At least one active administrator must remain.");
      }
    }

    const [updated] = await database
      .update(usersTable)
      .set({ status: input.status, updatedAt: new Date() })
      .where(eq(usersTable.id, target.id))
      .returning({
        id: usersTable.id,
        name: usersTable.name,
        email: usersTable.email,
        role: usersTable.role,
        status: usersTable.status,
        emailVerifiedAt: usersTable.emailVerifiedAt,
      });
    if (input.status === "SUSPENDED") {
      await database
        .delete(userSessionsTable)
        .where(eq(userSessionsTable.userId, target.id));
    }
    await database.insert(auditLogsTable).values({
      actorUserId: request.authUser!.id,
      action: input.status === "SUSPENDED" ? "USER_SUSPENDED" : "USER_REACTIVATED",
      targetType: "USER",
      targetId: target.id,
      metadata: { status: input.status },
    });
    response.json(
      Contract.AdminUpdateUserStatusResponse.parse(
        publicUser(toPrincipal(updated)),
      ),
    );
  },
);

const MODERATION = {
  APPROVE: { status: "OPEN", action: "REQUEST_APPROVED" },
  REJECT: { status: "REJECTED", action: "REQUEST_REJECTED" },
  REQUEST_CHANGES: { status: "NEEDS_MORE_INFORMATION", action: "REQUEST_CHANGES_REQUESTED" },
} as const;

router.patch(
  "/admin/requests/:id/moderation",
  requireAuth,
  requireRole("ADMIN"),
  async (request, response) => {
    const params = Contract.ModerateRequestParams.safeParse(request.params);
    const input = parseBody(
      Contract.ModerateRequestBody,
      request.body,
      response,
    );
    if (!params.success) {
      response.status(400).json({ error: "The request id is not valid." });
      return;
    }
    if (!input) return;
    const feedback = input.feedback?.trim() || null;
    if (input.decision !== "APPROVE" && (feedback?.length ?? 0) < 5) {
      throw new HttpError(400, "Tell the teacher what to change so they can fix it.");
    }
    const outcome = MODERATION[input.decision];
    if (input.decision === "APPROVE") {
      // Verification can lapse after a request was submitted. Never publish for a teacher
      // who is not fully verified right now.
      const [pendingRequest] = await requireDb()
        .select({ teacherUserId: assistanceRequestsTable.teacherUserId })
        .from(assistanceRequestsTable)
        .where(eq(assistanceRequestsTable.id, params.data.id))
        .limit(1);
      if (pendingRequest && !(await verifiedTeacherIds([pendingRequest.teacherUserId])).has(pendingRequest.teacherUserId)) {
        throw new HttpError(409, "This teacher's verification is no longer complete. Ask them to renew it, or request changes instead.");
      }
    }
    const [row] = await requireDb()
      .update(assistanceRequestsTable)
      .set({
        status: outcome.status,
        privateModerationNotes: input.note?.trim() || null,
        moderationFeedback: input.decision === "APPROVE" ? null : feedback,
        publishedAt: input.decision === "APPROVE" ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(assistanceRequestsTable.id, params.data.id),
          eq(assistanceRequestsTable.status, "PENDING_MODERATION"),
        ),
      )
      .returning();
    if (!row) throw new HttpError(404, "The request is not waiting for moderation.");

    await requireDb().insert(notificationsTable).values({
      userId: row.teacherUserId,
      type: "REQUEST_MODERATION",
      title:
        input.decision === "APPROVE"
          ? "Your school request is published"
          : input.decision === "REQUEST_CHANGES"
            ? "Your school request needs a few changes"
            : "Your school request was not approved",
      body:
        input.decision === "APPROVE"
          ? `${row.title} is now visible to donors.`
          : `${feedback} Open Requests to update and resubmit.`,
    });
    await requireDb().insert(auditLogsTable).values({
      actorUserId: request.authUser!.id,
      action: outcome.action,
      targetType: "ASSISTANCE_REQUEST",
      targetId: row.id,
    });
    const [school] = await requireDb()
      .select({ name: schoolsTable.name })
      .from(schoolsTable)
      .where(eq(schoolsTable.id, row.schoolId))
      .limit(1);
    response.json(
      Contract.ModerateRequestResponse.parse(toPublicRequest(row, school?.name)),
    );
  },
);

router.get(
  "/admin/verification",
  requireAuth,
  requireRole("ADMIN"),
  async (request, response) => {
    const query = Contract.ListVerificationQueueQueryParams.safeParse(request.query);
    const scope = query.success ? (query.data.scope ?? "pending") : "pending";
    const documentCount = sql<number>`(select count(*)::int from verification_documents d where d.user_id = ${verificationRecordsTable.userId} and d.stage = ${verificationRecordsTable.stage})`;
    const rows = await requireDb()
      .select({
        record: verificationRecordsTable,
        userName: usersTable.name,
        schoolName: schoolsTable.name,
        documentCount,
      })
      .from(verificationRecordsTable)
      .innerJoin(usersTable, eq(verificationRecordsTable.userId, usersTable.id))
      .leftJoin(schoolsTable, eq(verificationRecordsTable.schoolId, schoolsTable.id))
      .where(scope === "all" ? undefined : eq(verificationRecordsTable.status, "PENDING"))
      .orderBy(desc(verificationRecordsTable.submittedAt))
      .limit(300);
    response.json(
      Contract.ListVerificationQueueResponse.parse(
        rows.map((row) =>
          verificationRecordView(row.record, row.userName, {
            schoolName: row.schoolName,
            documentCount: row.documentCount ?? 0,
          }),
        ),
      ),
    );
  },
);

// Everything an administrator needs to decide: the submission, the applicant's
// documents, earlier submissions, and the audit trail. Private notes are admin-only.
router.get(
  "/admin/verification/:id",
  requireAuth,
  requireRole("ADMIN"),
  async (request, response) => {
    const params = Contract.GetAdminVerificationDetailParams.safeParse(request.params);
    if (!params.success) {
      response.status(400).json({ error: "The verification id is not valid." });
      return;
    }
    const database = requireDb();
    const [row] = await database
      .select({ record: verificationRecordsTable, userName: usersTable.name, email: usersTable.email })
      .from(verificationRecordsTable)
      .innerJoin(usersTable, eq(verificationRecordsTable.userId, usersTable.id))
      .where(eq(verificationRecordsTable.id, params.data.id))
      .limit(1);
    if (!row) throw new HttpError(404, "The verification record was not found.");
    const record = row.record;
    const [school] = record.schoolId
      ? await database
          .select({ name: schoolsTable.name, district: schoolsTable.district, status: schoolsTable.status })
          .from(schoolsTable)
          .where(eq(schoolsTable.id, record.schoolId))
          .limit(1)
      : [];
    const documents = record.stage
      ? await database
          .select()
          .from(verificationDocumentsTable)
          .where(
            and(
              eq(verificationDocumentsTable.userId, record.userId),
              eq(verificationDocumentsTable.stage, record.stage),
            ),
          )
          .orderBy(asc(verificationDocumentsTable.createdAt))
      : [];
    const reviewer = alias(usersTable, "reviewer");
    const history = await database
      .select({ record: verificationRecordsTable, reviewerName: reviewer.name })
      .from(verificationRecordsTable)
      .leftJoin(reviewer, eq(verificationRecordsTable.reviewedBy, reviewer.id))
      .where(eq(verificationRecordsTable.userId, record.userId))
      .orderBy(asc(verificationRecordsTable.createdAt));
    const recordIds = history.map((item) => item.record.id);
    const actor = alias(usersTable, "actor");
    const audit = recordIds.length
      ? await database
          .select({ action: auditLogsTable.action, actorName: actor.name, createdAt: auditLogsTable.createdAt })
          .from(auditLogsTable)
          .leftJoin(actor, eq(auditLogsTable.actorUserId, actor.id))
          .where(
            and(
              eq(auditLogsTable.targetType, "VERIFICATION"),
              inArray(auditLogsTable.targetId, recordIds),
            ),
          )
          .orderBy(asc(auditLogsTable.createdAt))
      : [];
    response.json(
      Contract.GetAdminVerificationDetailResponse.parse({
        record: verificationRecordView(record, row.userName, {
          schoolName: school?.name ?? null,
          documentCount: documents.length,
        }),
        applicant: { name: row.userName, email: row.email },
        school: school ?? null,
        privateNotes: record.privateReviewNotes,
        documents: documents.map(documentInfo),
        history: history.map((item) => ({
          id: item.record.id,
          stage: item.record.stage,
          status: item.record.status,
          submittedAt: item.record.submittedAt.toISOString(),
          reviewedAt: item.record.reviewedAt ? item.record.reviewedAt.toISOString() : null,
          reviewerName: item.reviewerName,
          feedback: item.record.reviewerFeedback,
        })),
        audit: audit.map((item) => ({
          action: item.action,
          actorName: item.actorName,
          createdAt: item.createdAt.toISOString(),
        })),
      }),
    );
  },
);

const DECISION_COPY = {
  APPROVE: {
    status: "VERIFIED",
    action: "VERIFICATION_APPROVED",
    title: "Verification step approved",
    body: "An administrator approved this step of your verification.",
  },
  REJECT: {
    status: "REJECTED",
    action: "VERIFICATION_REJECTED",
    title: "Verification step needs to be redone",
    body: "An administrator could not approve this step.",
  },
  REQUEST_INFO: {
    status: "NEEDS_MORE_INFORMATION",
    action: "VERIFICATION_INFO_REQUESTED",
    title: "More information needed for your verification",
    body: "An administrator needs a little more information.",
  },
  EXPIRE: {
    status: "EXPIRED",
    action: "VERIFICATION_EXPIRED",
    title: "A verification step has expired",
    body: "Please submit up-to-date evidence to keep publishing requests.",
  },
} as const;

router.patch(
  "/admin/verification/:id/decision",
  requireAuth,
  requireRole("ADMIN"),
  async (request, response) => {
    const params = Contract.DecideVerificationParams.safeParse(request.params);
    const input = parseBody(
      Contract.DecideVerificationBody,
      request.body,
      response,
    );
    if (!params.success) {
      response.status(400).json({ error: "The verification id is not valid." });
      return;
    }
    if (!input) return;
    const feedback = input.feedback?.trim() || null;
    if ((input.decision === "REJECT" || input.decision === "REQUEST_INFO") && (feedback?.length ?? 0) < 5) {
      throw new HttpError(400, "Explain your decision so the applicant knows what to do next.");
    }
    const copy = DECISION_COPY[input.decision];
    const database = requireDb();
    const row = await database.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(verificationRecordsTable)
        .where(eq(verificationRecordsTable.id, params.data.id))
        .limit(1);
      if (!current) throw new HttpError(404, "The verification record was not found.");
      const expected = input.decision === "EXPIRE" ? "VERIFIED" : "PENDING";
      if (current.status !== expected) {
        throw new HttpError(
          409,
          input.decision === "EXPIRE"
            ? "Only a verified record can be marked as expired."
            : "That submission has already been reviewed.",
        );
      }
      if (current.type === "DONOR" && (input.decision === "REQUEST_INFO" || input.decision === "EXPIRE")) {
        throw new HttpError(400, "That decision is only available for teacher verification.");
      }
      if (input.decision === "APPROVE" && current.type === "TEACHER") {
        if (current.stage === "PROFESSIONAL") {
          // Professional approval confirms the teacher's school affiliation, so the
          // school must already be a confirmed entry in the directory.
          const [school] = current.schoolId
            ? await tx.select({ status: schoolsTable.status }).from(schoolsTable).where(eq(schoolsTable.id, current.schoolId)).limit(1)
            : [];
          if (!school || school.status !== "ACTIVE") {
            throw new HttpError(409, "Confirm this school in the school directory first, then approve.");
          }
        }
        const docs = await tx
          .select({ id: verificationDocumentsTable.id })
          .from(verificationDocumentsTable)
          .where(
            and(
              eq(verificationDocumentsTable.userId, current.userId),
              eq(verificationDocumentsTable.stage, current.stage!),
            ),
          )
          .limit(1);
        if (docs.length === 0) throw new HttpError(409, "There is no evidence on file to approve.");
      }
      const [record] = await tx
        .update(verificationRecordsTable)
        .set({
          status: copy.status,
          reviewedBy: request.authUser!.id,
          reviewedAt: new Date(),
          privateReviewNotes: input.note?.trim() || current.privateReviewNotes,
          reviewerFeedback: feedback,
          expiresAt:
            input.decision === "APPROVE" && input.expiresAt ? new Date(input.expiresAt) : current.expiresAt,
          updatedAt: new Date(),
        })
        .where(and(eq(verificationRecordsTable.id, current.id), eq(verificationRecordsTable.status, expected)))
        .returning();
      if (!record) throw new HttpError(409, "That submission has already been reviewed.");
      if (input.decision === "APPROVE" && record.type === "DONOR") {
        await tx
          .update(donorInventoryTable)
          .set({ status: "AVAILABLE", updatedAt: new Date() })
          .where(and(eq(donorInventoryTable.donorUserId, record.userId), eq(donorInventoryTable.status, "DRAFT")));
      }
      await tx.insert(notificationsTable).values({
        userId: record.userId,
        type: "VERIFICATION_DECISION",
        title: copy.title,
        body: feedback ? `${copy.body} ${feedback}` : copy.body,
      });
      await tx.insert(auditLogsTable).values({
        actorUserId: request.authUser!.id,
        action: copy.action,
        targetType: "VERIFICATION",
        targetId: record.id,
        metadata: { type: record.type, stage: record.stage, status: record.status },
      });
      return record;
    });
    const [user] = await database
      .select({ name: usersTable.name })
      .from(usersTable)
      .where(eq(usersTable.id, row.userId))
      .limit(1);
    response.json(
      Contract.DecideVerificationResponse.parse(
        verificationRecordView(row, user?.name ?? "Account"),
      ),
    );
  },
);

router.get(
  "/admin/reports",
  requireAuth,
  requireRole("ADMIN"),
  async (_request, response) => {
    const rows = await requireDb()
      .select()
      .from(reportsTable)
      .orderBy(desc(reportsTable.createdAt))
      .limit(500);
    response.json(
      Contract.ListAdminReportsResponse.parse(
        rows.map((row) => ({
          id: row.id,
          targetType: row.targetType,
          targetId: row.targetId,
          reason: row.reason,
          details: row.details,
          status: row.status,
          createdAt: row.createdAt.toISOString(),
        })),
      ),
    );
  },
);

router.patch(
  "/admin/reports/:id/decision",
  requireAuth,
  requireRole("ADMIN"),
  async (request, response) => {
    const params = Contract.DecideReportParams.safeParse(request.params);
    const input = parseBody(Contract.DecideReportBody, request.body, response);
    if (!params.success) {
      response.status(400).json({ error: "The report id is not valid." });
      return;
    }
    if (!input) return;
    const [row] = await requireDb()
      .update(reportsTable)
      .set({
        status: input.decision,
        reviewedBy: request.authUser!.id,
        adminNotes: input.note?.trim() || null,
        resolvedAt: new Date(),
      })
      .where(eq(reportsTable.id, params.data.id))
      .returning();
    if (!row) throw new HttpError(404, "The report was not found.");
    await requireDb().insert(auditLogsTable).values({
      actorUserId: request.authUser!.id,
      action: `REPORT_${input.decision}`,
      targetType: "REPORT",
      targetId: row.id,
    });
    response.json(
      Contract.DecideReportResponse.parse({
        id: row.id,
        targetType: row.targetType,
        targetId: row.targetId,
        reason: row.reason,
        details: row.details,
        status: row.status,
        createdAt: row.createdAt.toISOString(),
      }),
    );
  },
);

export default router;
