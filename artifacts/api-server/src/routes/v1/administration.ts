import { Router } from "express";
import { and, count, desc, eq, not } from "drizzle-orm";
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
  verificationRecordsTable,
} from "@workspace/db";
import { requireAuth, requireRole } from "../../lib/auth-middleware";
import { HttpError } from "../../lib/errors";
import { publicUser } from "../../lib/security";
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
    const nextStatus =
      input.decision === "APPROVE" ? "OPEN" : "REJECTED";
    const [row] = await requireDb()
      .update(assistanceRequestsTable)
      .set({
        status: nextStatus,
        privateModerationNotes: input.note?.trim() || null,
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
          : "Your school request needs changes",
      body:
        input.decision === "APPROVE"
          ? `${row.title} is now visible to donors.`
          : "An administrator reviewed your request. Sign in to see the next steps.",
    });
    await requireDb().insert(auditLogsTable).values({
      actorUserId: request.authUser!.id,
      action: input.decision === "APPROVE" ? "REQUEST_APPROVED" : "REQUEST_REJECTED",
      targetType: "ASSISTANCE_REQUEST",
      targetId: row.id,
    });
    response.json(
      Contract.ModerateRequestResponse.parse({
        id: row.id,
        title: row.title,
        category: row.category,
        item: row.item,
        description: row.description,
        specifications: row.specifications ?? "",
        quantity: row.quantity,
        unit: row.unit,
        location: [row.area, row.district].filter(Boolean).join(" · "),
        schoolContext: `${row.district} school-level request`,
        priority:
          row.priority === "ESSENTIAL"
            ? "Essential"
            : row.priority === "HIGH"
              ? "High"
              : "Standard",
        status: nextStatus === "OPEN" ? "Open" : "Rejected",
        imageUrl: "/images/sedibeng-school-shoes.jpg",
        imageAlt: `${row.item} for a school assistance request`,
        updatedLabel: "Updated today",
        isSeedData: row.isSeedData,
      }),
    );
  },
);

router.get(
  "/admin/verification",
  requireAuth,
  requireRole("ADMIN"),
  async (_request, response) => {
    const rows = await requireDb()
      .select({
        id: verificationRecordsTable.id,
        userId: verificationRecordsTable.userId,
        userName: usersTable.name,
        type: verificationRecordsTable.type,
        status: verificationRecordsTable.status,
        applicantNote: verificationRecordsTable.applicantNote,
        documentProvided: verificationRecordsTable.documentObjectKey,
        submittedAt: verificationRecordsTable.submittedAt,
        reviewedAt: verificationRecordsTable.reviewedAt,
      })
      .from(verificationRecordsTable)
      .innerJoin(usersTable, eq(verificationRecordsTable.userId, usersTable.id))
      .where(eq(verificationRecordsTable.status, "PENDING"))
      .orderBy(desc(verificationRecordsTable.submittedAt));
    response.json(
      Contract.ListVerificationQueueResponse.parse(
        rows.map((row) => ({
          ...row,
          documentProvided: Boolean(row.documentProvided),
          submittedAt: row.submittedAt.toISOString(),
          reviewedAt: responseDate(row.reviewedAt),
        })),
      ),
    );
  },
);

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
    const database = requireDb();
    const row = await database.transaction(async (tx) => {
      const [record] = await tx
        .update(verificationRecordsTable)
        .set({
          status: input.decision === "APPROVE" ? "APPROVED" : "REJECTED",
          reviewedBy: request.authUser!.id,
          reviewedAt: new Date(),
          privateReviewNotes: input.note?.trim() || null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(verificationRecordsTable.id, params.data.id),
            eq(verificationRecordsTable.status, "PENDING"),
          ),
        )
        .returning();
      if (!record || input.decision !== "APPROVE") return record;
      if (record.type === "TEACHER") {
        const [profile] = await tx
          .select({ schoolId: teacherProfilesTable.schoolId })
          .from(teacherProfilesTable)
          .where(eq(teacherProfilesTable.userId, record.userId))
          .limit(1);
        if (profile) {
          await tx
            .update(schoolsTable)
            .set({ status: "ACTIVE", updatedAt: new Date() })
            .where(eq(schoolsTable.id, profile.schoolId));
        }
      } else {
        await tx
          .update(donorInventoryTable)
          .set({ status: "AVAILABLE", updatedAt: new Date() })
          .where(
            and(
              eq(donorInventoryTable.donorUserId, record.userId),
              eq(donorInventoryTable.status, "DRAFT"),
            ),
          );
      }
      return record;
    });
    if (!row) throw new HttpError(404, "The verification record was not found.");
    await database.insert(notificationsTable).values({
      userId: row.userId,
      type: "VERIFICATION_DECISION",
      title:
        input.decision === "APPROVE"
          ? "Your account verification is complete"
          : "Your account verification needs attention",
      body:
        input.decision === "APPROVE"
          ? "You can now offer goods and participate in matching."
          : "An administrator reviewed your verification. Contact support if you need help.",
    });
    await database.insert(auditLogsTable).values({
      actorUserId: request.authUser!.id,
      action:
        input.decision === "APPROVE"
          ? "VERIFICATION_APPROVED"
          : "VERIFICATION_REJECTED",
      targetType: "VERIFICATION",
      targetId: row.id,
      metadata: { type: row.type },
    });
    const [user] = await database
      .select({ name: usersTable.name })
      .from(usersTable)
      .where(eq(usersTable.id, row.userId))
      .limit(1);
    response.json(
      Contract.DecideVerificationResponse.parse({
        id: row.id,
        userId: row.userId,
        userName: user?.name ?? "Account",
        type: row.type,
        status: row.status,
        applicantNote: row.applicantNote,
        documentProvided: Boolean(row.documentObjectKey),
        submittedAt: row.submittedAt.toISOString(),
        reviewedAt: responseDate(row.reviewedAt),
      }),
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
