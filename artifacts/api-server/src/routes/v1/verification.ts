import { createHash } from "node:crypto";
import express, { Router, type NextFunction, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { and, asc, eq, isNull } from "drizzle-orm";
import * as Contract from "@workspace/api-zod";
import {
  auditLogsTable,
  requireDb,
  teacherProfilesTable,
  verificationDocumentsTable,
  verificationRecordsTable,
} from "@workspace/db";
import { requireAuth, requireRole } from "../../lib/auth-middleware";
import { HttpError } from "../../lib/errors";
import {
  documentUrlTtlSeconds,
  getStorage,
  newObjectKey,
  readLocalObject,
  verifyLocalToken,
} from "../../lib/storage";
import {
  ALLOWED_DOCUMENT_TYPES,
  MAX_DOCUMENT_BYTES,
  isAllowedContentType,
  matchesMagicBytes,
  sanitizeFilename,
} from "../../lib/uploads";
import { getTeacherEligibility, type Stage, type StageState } from "../../lib/verification";
import { parseBody, responseDate } from "./shared";

const router = Router();

const STAGE_DOCUMENT_TYPES: Record<Stage, readonly string[]> = {
  IDENTITY: ["NATIONAL_ID", "PASSPORT", "DRIVING_LICENCE", "OTHER"],
  PROFESSIONAL: ["TEACHING_LICENCE", "EMPLOYMENT_LETTER", "SCHOOL_CONFIRMATION", "OTHER"],
};
const MAX_DRAFT_DOCUMENTS_PER_STAGE = 5;

const uploadLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_request, response) =>
    response.status(429).json({ error: "Too many uploads. Try again later." }),
});

function parseStage(value: unknown): Stage {
  if (value === "IDENTITY" || value === "PROFESSIONAL") return value;
  throw new HttpError(400, "Choose a verification stage: identity or professional.");
}

/** A stage accepts new evidence unless it is under review or already confirmed. */
function stageAcceptsEvidence(state: StageState, currentSchoolId: string | null) {
  if (state.status === "PENDING") return false;
  if (state.status === "VERIFIED") {
    return state.stage === "PROFESSIONAL" && currentSchoolId !== null && state.schoolId !== currentSchoolId;
  }
  return true;
}

export function documentInfo(row: typeof verificationDocumentsTable.$inferSelect) {
  return {
    id: row.id,
    stage: row.stage,
    documentType: row.documentType,
    originalFilename: row.originalFilename,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    createdAt: row.createdAt.toISOString(),
    recordId: row.recordId,
    submitted: row.recordId !== null,
  };
}

async function stageView(
  userId: string,
  state: StageState,
  currentSchoolId: string | null,
) {
  const docs = await requireDb()
    .select()
    .from(verificationDocumentsTable)
    .where(
      and(
        eq(verificationDocumentsTable.userId, userId),
        eq(verificationDocumentsTable.stage, state.stage),
      ),
    )
    .orderBy(asc(verificationDocumentsTable.createdAt));
  return {
    stage: state.stage,
    status: state.status,
    submittedAt: responseDate(state.submittedAt),
    reviewedAt: responseDate(state.reviewedAt),
    feedback: state.feedback,
    expiresAt: responseDate(state.expiresAt),
    canSubmit: stageAcceptsEvidence(state, currentSchoolId),
    documents: docs.map(documentInfo),
  };
}

router.get("/teacher/verification", requireAuth, requireRole("TEACHER"), async (request, response) => {
  const eligibility = await getTeacherEligibility(request.authUser!.id);
  const [identity, professional] = await Promise.all([
    stageView(request.authUser!.id, eligibility.stages.IDENTITY, eligibility.schoolId),
    stageView(request.authUser!.id, eligibility.stages.PROFESSIONAL, eligibility.schoolId),
  ]);
  response.json(
    Contract.GetTeacherVerificationResponse.parse({
      eligible: eligibility.eligible,
      reasons: eligibility.reasons,
      school: eligibility.schoolId
        ? { id: eligibility.schoolId, name: eligibility.schoolName, status: eligibility.schoolStatus }
        : null,
      storageConfigured: getStorage() !== null,
      identity,
      professional,
    }),
  );
});

// Raw file upload. The body is the file itself (PDF, JPEG or PNG, max 5 MB).
function rawDocumentBody(request: Request, response: Response, next: NextFunction) {
  express.raw({
    type: Object.keys(ALLOWED_DOCUMENT_TYPES),
    limit: MAX_DOCUMENT_BYTES,
  })(request, response, (error?: unknown) => {
    if (error) {
      const status = (error as { status?: number }).status;
      next(new HttpError(status === 413 ? 413 : 400, status === 413 ? "That file is too large. The limit is 5 MB." : "The file could not be read."));
      return;
    }
    next();
  });
}

router.post(
  "/teacher/verification/documents",
  requireAuth,
  requireRole("TEACHER"),
  uploadLimit,
  rawDocumentBody,
  async (request, response) => {
    const storage = getStorage();
    if (!storage) {
      throw new HttpError(503, "Document storage is not configured on this server.");
    }
    const stage = parseStage(request.query.stage);
    const documentType = String(request.query.documentType ?? "");
    if (!STAGE_DOCUMENT_TYPES[stage].includes(documentType)) {
      throw new HttpError(400, "That document type does not belong to this verification stage.");
    }
    const declared = request.get("content-type")?.split(";")[0]?.trim().toLowerCase();
    if (!isAllowedContentType(declared)) {
      throw new HttpError(415, "Only PDF, JPEG or PNG files can be uploaded.");
    }
    const body = request.body;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      throw new HttpError(400, "The file is empty.");
    }
    if (body.length > MAX_DOCUMENT_BYTES) {
      throw new HttpError(413, "That file is too large. The limit is 5 MB.");
    }
    if (!matchesMagicBytes(body, declared)) {
      throw new HttpError(415, "That file does not look like a real PDF, JPEG or PNG.");
    }

    const userId = request.authUser!.id;
    const eligibility = await getTeacherEligibility(userId);
    if (!stageAcceptsEvidence(eligibility.stages[stage], eligibility.schoolId)) {
      throw new HttpError(409, "This stage is already under review or verified.");
    }
    const database = requireDb();
    const drafts = await database
      .select({ id: verificationDocumentsTable.id })
      .from(verificationDocumentsTable)
      .where(
        and(
          eq(verificationDocumentsTable.userId, userId),
          eq(verificationDocumentsTable.stage, stage),
          isNull(verificationDocumentsTable.recordId),
        ),
      );
    if (drafts.length >= MAX_DRAFT_DOCUMENTS_PER_STAGE) {
      throw new HttpError(409, `You can attach up to ${MAX_DRAFT_DOCUMENTS_PER_STAGE} files per stage.`);
    }

    const key = newObjectKey(userId, ALLOWED_DOCUMENT_TYPES[declared].extension);
    await storage.put(key, body, declared);
    let row;
    try {
      [row] = await database
        .insert(verificationDocumentsTable)
        .values({
          userId,
          stage,
          documentType: documentType as (typeof verificationDocumentsTable.$inferInsert)["documentType"],
          originalFilename: sanitizeFilename(typeof request.query.filename === "string" ? request.query.filename : undefined),
          contentType: declared,
          sizeBytes: body.length,
          sha256: createHash("sha256").update(body).digest("hex"),
          objectKey: key,
        })
        .returning();
    } catch (error) {
      await storage.remove(key).catch(() => undefined);
      throw error;
    }
    await database.insert(auditLogsTable).values({
      actorUserId: userId,
      action: "VERIFICATION_DOCUMENT_UPLOADED",
      targetType: "VERIFICATION_DOCUMENT",
      targetId: row.id,
      metadata: { stage, documentType, sizeBytes: body.length },
    });
    response.status(201).json(Contract.UploadVerificationDocumentResponse.parse(documentInfo(row)));
  },
);

router.delete(
  "/teacher/verification/documents/:id",
  requireAuth,
  requireRole("TEACHER"),
  async (request, response) => {
    const params = Contract.DeleteVerificationDocumentParams.safeParse(request.params);
    if (!params.success) {
      response.status(400).json({ error: "The document id is not valid." });
      return;
    }
    const database = requireDb();
    // Only unsubmitted drafts can be removed; submitted evidence is kept for review history.
    const [row] = await database
      .delete(verificationDocumentsTable)
      .where(
        and(
          eq(verificationDocumentsTable.id, params.data.id),
          eq(verificationDocumentsTable.userId, request.authUser!.id),
          isNull(verificationDocumentsTable.recordId),
        ),
      )
      .returning();
    if (!row) throw new HttpError(404, "That attachment could not be removed.");
    await getStorage()?.remove(row.objectKey).catch(() => undefined);
    await database.insert(auditLogsTable).values({
      actorUserId: request.authUser!.id,
      action: "VERIFICATION_DOCUMENT_REMOVED",
      targetType: "VERIFICATION_DOCUMENT",
      targetId: row.id,
      metadata: { stage: row.stage },
    });
    response.json(Contract.DeleteVerificationDocumentResponse.parse({ id: row.id }));
  },
);

router.post(
  "/teacher/verification/:stage/submit",
  requireAuth,
  requireRole("TEACHER"),
  async (request, response) => {
    const params = Contract.SubmitTeacherVerificationStageParams.safeParse(request.params);
    const input = parseBody(Contract.SubmitTeacherVerificationStageBody, request.body, response);
    if (!params.success) {
      response.status(400).json({ error: "Choose a verification stage: identity or professional." });
      return;
    }
    if (!input) return;
    const stage = params.data.stage as Stage;
    const userId = request.authUser!.id;
    const database = requireDb();

    await database.transaction(async (tx) => {
      const eligibility = await getTeacherEligibility(userId);
      const state = eligibility.stages[stage];
      if (state.status === "PENDING") throw new HttpError(409, "This stage is already being reviewed.");
      if (!stageAcceptsEvidence(state, eligibility.schoolId)) {
        throw new HttpError(409, "This stage is already verified.");
      }
      const [profile] = await tx
        .select({ schoolId: teacherProfilesTable.schoolId })
        .from(teacherProfilesTable)
        .where(eq(teacherProfilesTable.userId, userId))
        .limit(1);
      if (!profile) throw new HttpError(404, "Teacher profile was not found.");

      const docs = await tx
        .select()
        .from(verificationDocumentsTable)
        .where(and(eq(verificationDocumentsTable.userId, userId), eq(verificationDocumentsTable.stage, stage)));
      const drafts = docs.filter((doc) => doc.recordId === null);
      const note = input.note?.trim() ?? "";
      const respondingToRequest = state.status === "NEEDS_MORE_INFORMATION";
      if (drafts.length === 0 && !(respondingToRequest && (docs.length > 0 && note.length > 0))) {
        throw new HttpError(
          400,
          respondingToRequest
            ? "Add a file or write a reply to the administrator's question."
            : "Attach at least one document before submitting.",
        );
      }

      const [created] = await tx
        .insert(verificationRecordsTable)
        .values({
          userId,
          type: "TEACHER",
          stage,
          status: "PENDING",
          applicantNote: note || null,
          schoolId: stage === "PROFESSIONAL" ? profile.schoolId : null,
        })
        .returning();
      for (const draft of drafts) {
        await tx
          .update(verificationDocumentsTable)
          .set({ recordId: created.id })
          .where(eq(verificationDocumentsTable.id, draft.id));
      }
      await tx.insert(auditLogsTable).values({
        actorUserId: userId,
        action: "VERIFICATION_SUBMITTED",
        targetType: "VERIFICATION",
        targetId: created.id,
        metadata: { type: "TEACHER", stage, documents: drafts.length },
      });
      return created;
    });

    const eligibility = await getTeacherEligibility(userId);
    response.status(201).json(
      Contract.SubmitTeacherVerificationStageResponse.parse(
        await stageView(userId, eligibility.stages[stage], eligibility.schoolId),
      ),
    );

  },
);

// Owner or administrator opens a document. Always audit-logged; the URL is short-lived.
router.post("/verification/documents/:id/access", requireAuth, async (request, response) => {
  const params = Contract.AccessVerificationDocumentParams.safeParse(request.params);
  if (!params.success) {
    response.status(400).json({ error: "The document id is not valid." });
    return;
  }
  const user = request.authUser!;
  const [doc] = await requireDb()
    .select()
    .from(verificationDocumentsTable)
    .where(eq(verificationDocumentsTable.id, params.data.id))
    .limit(1);
  // Not the owner and not an admin: behave as if it does not exist.
  if (!doc || (user.role !== "ADMIN" && doc.userId !== user.id)) {
    throw new HttpError(404, "That document was not found.");
  }
  const storage = getStorage();
  if (!storage) throw new HttpError(503, "Document storage is not configured on this server.");
  const baseUrl = `${request.protocol}://${request.get("host")}`;
  const url = await storage.signedGetUrl({
    key: doc.objectKey,
    filename: doc.originalFilename,
    contentType: doc.contentType,
    baseUrl,
  });
  await requireDb().insert(auditLogsTable).values({
    actorUserId: user.id,
    action: "VERIFICATION_DOCUMENT_ACCESSED",
    targetType: "VERIFICATION_DOCUMENT",
    targetId: doc.id,
    metadata: { ownerUserId: doc.userId, accessorRole: user.role, stage: doc.stage },
  });
  response.set("Cache-Control", "no-store");
  response.json(
    Contract.AccessVerificationDocumentResponse.parse({
      url,
      expiresInSeconds: documentUrlTtlSeconds(),
      filename: doc.originalFilename,
    }),
  );
});

// Development-only: serves files for the local storage driver via a signed, expiring token.
router.get("/documents/local/:token", async (request, response) => {
  const storage = getStorage();
  const claims = storage?.driver === "local" ? verifyLocalToken(String(request.params.token)) : null;
  if (!claims) {
    response.status(404).json({ error: "That link has expired or is not valid." });
    return;
  }
  const bytes = await readLocalObject(claims.k).catch(() => null);
  if (!bytes) {
    response.status(404).json({ error: "That link has expired or is not valid." });
    return;
  }
  response.set({
    "Content-Type": claims.c,
    "Content-Disposition": `inline; filename="${claims.f.replace(/[^\w.\- ()]/g, "_")}"`,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox; default-src 'none'",
  });
  response.send(bytes);
});

export default router;
