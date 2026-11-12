import { Router } from "express";
import { and, asc, count, eq, ilike, or, type SQL } from "drizzle-orm";
import * as Contract from "@workspace/api-zod";
import { auditLogsTable, requireDb, schoolsTable, teacherProfilesTable } from "@workspace/db";
import { requireAuth, requireRole } from "../../lib/auth-middleware";
import { HttpError } from "../../lib/errors";
import { parseBody } from "./shared";

const router = Router();

function isUniqueViolation(error: unknown) {
  const code = (error as { code?: string; cause?: { code?: string } })?.code ?? (error as { cause?: { code?: string } })?.cause?.code;
  return code === "23505";
}

async function withTeacherCount(row: typeof schoolsTable.$inferSelect) {
  const [{ value }] = await requireDb()
    .select({ value: count() })
    .from(teacherProfilesTable)
    .where(eq(teacherProfilesTable.schoolId, row.id));
  return view(row, value);
}

function view(row: typeof schoolsTable.$inferSelect, teacherCount: number) {
  return {
    id: row.id,
    name: row.name,
    schoolType: row.schoolType,
    district: row.district,
    area: row.area,
    generalLocation: row.generalLocation,
    status: row.status,
    teacherCount,
  };
}

function clean(input: { name: string; district: string; area?: string | null; generalLocation?: string | null; schoolType?: string | null }) {
  return {
    name: input.name.trim(),
    district: input.district.trim(),
    area: input.area?.trim() || null,
    generalLocation: input.generalLocation?.trim() || null,
    schoolType: (input.schoolType ?? null) as typeof schoolsTable.$inferInsert["schoolType"],
  };
}

router.get("/admin/schools", requireAuth, requireRole("ADMIN"), async (request, response) => {
  const query = Contract.ListAdminSchoolsQueryParams.safeParse(request.query);
  if (!query.success) {
    response.status(400).json({ error: "School filters are not valid." });
    return;
  }
  const filters: SQL[] = [];
  if (query.data.status) filters.push(eq(schoolsTable.status, query.data.status));
  if (query.data.search?.trim()) {
    const term = `%${query.data.search.trim().slice(0, 100)}%`;
    filters.push(or(ilike(schoolsTable.name, term), ilike(schoolsTable.district, term), ilike(schoolsTable.area, term))!);
  }
  const rows = await requireDb()
    .select({ school: schoolsTable, teachers: count(teacherProfilesTable.id) })
    .from(schoolsTable)
    .leftJoin(teacherProfilesTable, eq(teacherProfilesTable.schoolId, schoolsTable.id))
    .where(filters.length ? and(...filters) : undefined)
    .groupBy(schoolsTable.id)
    .orderBy(asc(schoolsTable.district), asc(schoolsTable.name))
    .limit(500);
  response.json(Contract.ListAdminSchoolsResponse.parse(rows.map((row) => view(row.school, row.teachers))));
});

router.post("/admin/schools", requireAuth, requireRole("ADMIN"), async (request, response) => {
  const input = parseBody(Contract.CreateAdminSchoolBody, request.body, response);
  if (!input) return;
  try {
    const [row] = await requireDb()
      .insert(schoolsTable)
      .values({ ...clean(input), status: input.status })
      .returning();
    await requireDb().insert(auditLogsTable).values({
      actorUserId: request.authUser!.id,
      action: "SCHOOL_CREATED",
      targetType: "SCHOOL",
      targetId: row.id,
      metadata: { status: row.status },
    });
    response.status(201).json(Contract.CreateAdminSchoolResponse.parse(view(row, 0)));
  } catch (error) {
    if (isUniqueViolation(error)) throw new HttpError(409, "That school is already in the directory.");
    throw error;
  }
});

router.patch("/admin/schools/:id", requireAuth, requireRole("ADMIN"), async (request, response) => {
  const params = Contract.UpdateAdminSchoolParams.safeParse(request.params);
  const input = parseBody(Contract.UpdateAdminSchoolBody, request.body, response);
  if (!params.success) {
    response.status(400).json({ error: "The school id is not valid." });
    return;
  }
  if (!input) return;
  try {
    const [row] = await requireDb()
      .update(schoolsTable)
      .set({ ...clean(input), status: input.status, updatedAt: new Date() })
      .where(eq(schoolsTable.id, params.data.id))
      .returning();
    if (!row) throw new HttpError(404, "That school was not found.");
    await requireDb().insert(auditLogsTable).values({
      actorUserId: request.authUser!.id,
      action: "SCHOOL_UPDATED",
      targetType: "SCHOOL",
      targetId: row.id,
      metadata: { status: row.status },
    });
    response.json(Contract.UpdateAdminSchoolResponse.parse(await withTeacherCount(row)));
  } catch (error) {
    if (isUniqueViolation(error)) throw new HttpError(409, "Another school already has that name and area.");
    throw error;
  }
});

export default router;
