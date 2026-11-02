import { Router } from "express";
import { and, desc, eq, ilike, or } from "drizzle-orm";
import * as Contract from "@workspace/api-zod";
import {
  auditLogsTable,
  requireDb,
  schoolsTable,
  teacherProfilesTable,
  verificationRecordsTable,
} from "@workspace/db";
import { requireAuth, requireRole } from "../../lib/auth-middleware";
import { HttpError } from "../../lib/errors";
import { parseBody, responseDate } from "./shared";

const router = Router();

router.get("/schools", async (request, response) => {
  const query = Contract.ListSchoolsQueryParams.safeParse(request.query);
  if (!query.success) {
    response.status(400).json({ error: "School filters are not valid." });
    return;
  }
  const filters = [eq(schoolsTable.status, "ACTIVE")];
  if (query.data.district) {
    filters.push(eq(schoolsTable.district, query.data.district.trim()));
  }
  if (query.data.search?.trim()) {
    const term = `%${query.data.search.trim().slice(0, 100)}%`;
    filters.push(
      or(
        ilike(schoolsTable.name, term),
        ilike(schoolsTable.area, term),
        ilike(schoolsTable.district, term),
      )!,
    );
  }
  const rows = await requireDb()
    .select({
      id: schoolsTable.id,
      name: schoolsTable.name,
      district: schoolsTable.district,
      area: schoolsTable.area,
    })
    .from(schoolsTable)
    .where(and(...filters))
    .orderBy(schoolsTable.district, schoolsTable.name)
    .limit(100);
  response.json(Contract.ListSchoolsResponse.parse(rows));
});

router.get(
  "/teacher-profile",
  requireAuth,
  requireRole("TEACHER"),
  async (request, response) => {
    const [profile] = await requireDb()
      .select({
        id: teacherProfilesTable.id,
        schoolId: schoolsTable.id,
        schoolName: schoolsTable.name,
        district: schoolsTable.district,
        area: schoolsTable.area,
        position: teacherProfilesTable.position,
        schoolStatus: schoolsTable.status,
      })
      .from(teacherProfilesTable)
      .innerJoin(schoolsTable, eq(teacherProfilesTable.schoolId, schoolsTable.id))
      .where(eq(teacherProfilesTable.userId, request.authUser!.id))
      .limit(1);
    if (!profile) throw new HttpError(404, "Teacher profile was not found.");
    response.json(Contract.GetTeacherProfileResponse.parse(profile));
  },
);

router.patch(
  "/teacher-profile",
  requireAuth,
  requireRole("TEACHER"),
  async (request, response) => {
    const input = parseBody(
      Contract.UpdateTeacherProfileBody,
      request.body,
      response,
    );
    if (!input) return;
    const [updated] = await requireDb()
      .update(teacherProfilesTable)
      .set({ position: input.position?.trim() || null, updatedAt: new Date() })
      .where(eq(teacherProfilesTable.userId, request.authUser!.id))
      .returning({
        id: teacherProfilesTable.id,
        schoolId: teacherProfilesTable.schoolId,
        position: teacherProfilesTable.position,
      });
    if (!updated) throw new HttpError(404, "Teacher profile was not found.");
    const [school] = await requireDb()
      .select({
        name: schoolsTable.name,
        district: schoolsTable.district,
        area: schoolsTable.area,
        status: schoolsTable.status,
      })
      .from(schoolsTable)
      .where(eq(schoolsTable.id, updated.schoolId))
      .limit(1);
    if (!school) throw new HttpError(404, "School was not found.");
    response.json(
      Contract.UpdateTeacherProfileResponse.parse({
        id: updated.id,
        schoolId: updated.schoolId,
        schoolName: school.name,
        district: school.district,
        area: school.area,
        position: updated.position,
        schoolStatus: school.status,
      }),
    );
  },
);

router.get("/verification", requireAuth, async (request, response) => {
  const records = await requireDb()
    .select()
    .from(verificationRecordsTable)
    .where(eq(verificationRecordsTable.userId, request.authUser!.id))
    .orderBy(desc(verificationRecordsTable.createdAt));
  response.json(
    Contract.GetMyVerificationResponse.parse(
      records.map((record) => ({
        id: record.id,
        userId: record.userId,
        userName: request.authUser!.name,
        type: record.type,
        status: record.status,
        applicantNote: record.applicantNote,
        documentProvided: Boolean(record.documentObjectKey),
        submittedAt: record.submittedAt.toISOString(),
        reviewedAt: responseDate(record.reviewedAt),
      })),
    ),
  );
});

router.post(
  "/verification",
  requireAuth,
  requireRole("DONOR", "TEACHER"),
  async (request, response) => {
    const input = parseBody(
      Contract.SubmitVerificationBody,
      request.body,
      response,
    );
    if (!input) return;
    const database = requireDb();
    const [existing] = await database
      .select({ id: verificationRecordsTable.id })
      .from(verificationRecordsTable)
      .where(
        and(
          eq(verificationRecordsTable.userId, request.authUser!.id),
          eq(verificationRecordsTable.status, "PENDING"),
        ),
      )
      .limit(1);
    if (existing) {
      throw new HttpError(409, "A verification request is already being reviewed.");
    }
    const [record] = await database
      .insert(verificationRecordsTable)
      .values({
        userId: request.authUser!.id,
        type: request.authUser!.role === "TEACHER" ? "TEACHER" : "DONOR",
        status: "PENDING",
        applicantNote: input.note.trim() || null,
      })
      .returning();
    await database.insert(auditLogsTable).values({
      actorUserId: request.authUser!.id,
      action: "VERIFICATION_SUBMITTED",
      targetType: "VERIFICATION",
      targetId: record.id,
      metadata: { type: record.type },
    });
    response.status(201).json(
      Contract.SubmitVerificationResponse.parse({
        id: record.id,
        userId: record.userId,
        userName: request.authUser!.name,
        type: record.type,
        status: record.status,
        applicantNote: record.applicantNote,
        documentProvided: false,
        submittedAt: record.submittedAt.toISOString(),
        reviewedAt: null,
      }),
    );
  },
);

export default router;
