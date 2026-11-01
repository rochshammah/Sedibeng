import { Router } from "express";
import rateLimit from "express-rate-limit";
import { and, desc, eq, ilike, or } from "drizzle-orm";
import * as Contract from "@workspace/api-zod";
import {
  assistanceRequestsTable,
  requireDb,
  schoolsTable,
  teacherProfilesTable,
  verificationRecordsTable,
} from "@workspace/db";
import { requireAuth, requireRole } from "../../lib/auth-middleware";
import { HttpError } from "../../lib/errors";
import { parseBody } from "./shared";

const router = Router();
const createLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 12,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_request, response) =>
    response.status(429).json({ error: "Too many requests. Try again later." }),
});

function likeTerm(value: string) {
  return `%${value.replace(/[\\%_]/g, "\\$&")}%`;
}

function priorityLabel(priority: string): "Essential" | "High" | "Standard" {
  if (priority === "ESSENTIAL") return "Essential";
  if (priority === "HIGH") return "High";
  return "Standard";
}

function requestStatusLabel(
  status: string,
):
  | "Pending moderation"
  | "Open"
  | "Partially matched"
  | "Matched"
  | "Rejected"
  | "Cancelled"
  | "Fulfilled" {
  if (status === "PENDING_MODERATION") return "Pending moderation";
  if (status === "PARTIALLY_MATCHED") return "Partially matched";
  if (status === "MATCHED") return "Matched";
  if (status === "REJECTED") return "Rejected";
  if (status === "CANCELLED") return "Cancelled";
  if (status === "FULFILLED") return "Fulfilled";
  return "Open";
}

function itemImage(category: string) {
  const normalized = category.toLowerCase();
  if (normalized.includes("book") || normalized.includes("read")) {
    return "/images/sedibeng-backpack-books.jpg";
  }
  if (normalized.includes("station") || normalized.includes("pencil")) {
    return "/images/sedibeng-stationery-kit.jpg";
  }
  return "/images/sedibeng-school-shoes.jpg";
}

function updatedLabel(value: Date) {
  const days = Math.floor((Date.now() - value.getTime()) / 86_400_000);
  if (days <= 0) return "Updated today";
  if (days === 1) return "Updated yesterday";
  if (days < 30) return `Updated ${days} days ago`;
  return `Updated ${Math.floor(days / 30)} months ago`;
}

function toPublicRequest(
  row: typeof assistanceRequestsTable.$inferSelect,
  schoolName?: string,
) {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    item: row.item,
    description: row.description,
    specifications: row.specifications ?? "",
    quantity: row.quantity,
    unit: row.unit,
    location: [row.area, row.district].filter(Boolean).join(" · "),
    schoolContext: schoolName
      ? `${schoolName} · ${row.district}`
      : `${row.district} school-level request`,
    priority: priorityLabel(row.priority),
    status: requestStatusLabel(row.status),
    imageUrl: itemImage(row.category),
    imageAlt: `${row.item} for a school assistance request`,
    updatedLabel: updatedLabel(row.updatedAt),
    isSeedData: row.isSeedData,
  };
}

async function findProfileSchool(userId: string) {
  const [profile] = await requireDb()
    .select({
      schoolId: teacherProfilesTable.schoolId,
      schoolName: schoolsTable.name,
      district: schoolsTable.district,
      area: schoolsTable.area,
    })
    .from(teacherProfilesTable)
    .innerJoin(schoolsTable, eq(teacherProfilesTable.schoolId, schoolsTable.id))
    .where(eq(teacherProfilesTable.userId, userId))
    .limit(1);
  if (!profile) throw new HttpError(403, "Complete your teacher profile first.");
  return profile;
}

router.get("/requests", async (request, response) => {
  const query = Contract.GetRequestsQueryParams.safeParse(request.query);
  if (!query.success) {
    response.status(400).json({ error: "Request filters are not valid." });
    return;
  }
  const filters = [
    or(
      eq(assistanceRequestsTable.status, "OPEN"),
      eq(assistanceRequestsTable.status, "PARTIALLY_MATCHED"),
      eq(assistanceRequestsTable.status, "MATCHED"),
    ),
  ];
  if (process.env.NODE_ENV === "production") {
    filters.push(eq(assistanceRequestsTable.isSeedData, false));
  }
  if (query.data.category) {
    filters.push(eq(assistanceRequestsTable.category, query.data.category));
  }
  if (query.data.priority) {
    const normalizedPriority = query.data.priority.toUpperCase();
    if (["STANDARD", "HIGH", "ESSENTIAL"].includes(normalizedPriority)) {
      filters.push(
        eq(
          assistanceRequestsTable.priority,
          normalizedPriority as "STANDARD" | "HIGH" | "ESSENTIAL",
        ),
      );
    }
  }
  if (query.data.search?.trim()) {
    const term = likeTerm(query.data.search.trim().slice(0, 100));
    filters.push(
      or(
        ilike(assistanceRequestsTable.title, term),
        ilike(assistanceRequestsTable.item, term),
        ilike(assistanceRequestsTable.category, term),
        ilike(assistanceRequestsTable.district, term),
      )!,
    );
  }

  const rows = await requireDb()
    .select()
    .from(assistanceRequestsTable)
    .where(and(...filters))
    .orderBy(desc(assistanceRequestsTable.priority), desc(assistanceRequestsTable.createdAt))
    .limit(100);
  response.json(
    Contract.GetRequestsResponse.parse(rows.map((row) => toPublicRequest(row))),
  );
});

router.get("/requests/:id", async (request, response) => {
  const params = Contract.GetRequestParams.safeParse(request.params);
  if (!params.success) {
    response.status(400).json({ error: "The request id is not valid." });
    return;
  }
  const [row] = await requireDb()
    .select()
    .from(assistanceRequestsTable)
    .where(
      and(
        eq(assistanceRequestsTable.id, params.data.id),
        or(
          eq(assistanceRequestsTable.status, "OPEN"),
          eq(assistanceRequestsTable.status, "PARTIALLY_MATCHED"),
          eq(assistanceRequestsTable.status, "MATCHED"),
        ),
        process.env.NODE_ENV === "production"
          ? eq(assistanceRequestsTable.isSeedData, false)
          : undefined,
      ),
    )
    .limit(1);
  if (!row) throw new HttpError(404, "The request was not found.");
  const [school] = await requireDb()
    .select({ name: schoolsTable.name })
    .from(schoolsTable)
    .where(eq(schoolsTable.id, row.schoolId))
    .limit(1);
  response.json(
    Contract.GetRequestResponse.parse(toPublicRequest(row, school?.name)),
  );
});

router.post(
  "/requests",
  requireAuth,
  requireRole("TEACHER"),
  createLimit,
  async (request, response) => {
    const input = parseBody(Contract.CreateRequestBody, request.body, response);
    if (!input) return;
    const profile = await findProfileSchool(request.authUser!.id);
    const [verification] = await requireDb()
      .select({ id: verificationRecordsTable.id })
      .from(verificationRecordsTable)
      .where(
        and(
          eq(verificationRecordsTable.userId, request.authUser!.id),
          eq(verificationRecordsTable.type, "TEACHER"),
          eq(verificationRecordsTable.status, "APPROVED"),
        ),
      )
      .limit(1);
    if (!verification) {
      throw new HttpError(403, "Complete account verification before submitting a request.");
    }
    if (profile.schoolId !== input.schoolId) {
      throw new HttpError(403, "Requests can only be created for your own school.");
    }
    const [school] = await requireDb()
      .select()
      .from(schoolsTable)
      .where(eq(schoolsTable.id, profile.schoolId))
      .limit(1);
    if (!school) throw new HttpError(404, "The school was not found.");

    const [row] = await requireDb()
      .insert(assistanceRequestsTable)
      .values({
        teacherUserId: request.authUser!.id,
        schoolId: profile.schoolId,
        title: input.title.trim(),
        category: input.category.trim(),
        item: input.item.trim(),
        description: input.description.trim(),
        specifications: input.specifications?.trim() || null,
        quantity: input.quantity,
        unit: input.unit.trim(),
        district: school.district,
        area: school.area,
        schoolContext: input.schoolContext.trim(),
        priority: input.priority,
        status: "PENDING_MODERATION",
        isSeedData: false,
      })
      .returning();
    response.status(201).json(
      Contract.CreateRequestResponse.parse(toPublicRequest(row, school.name)),
    );
  },
);

router.patch(
  "/requests/:id",
  requireAuth,
  requireRole("TEACHER"),
  async (request, response) => {
    const params = Contract.UpdateRequestParams.safeParse(request.params);
    const input = parseBody(Contract.UpdateRequestBody, request.body, response);
    if (!params.success) {
      response.status(400).json({ error: "The request id is not valid." });
      return;
    }
    if (!input) return;
    const profile = await findProfileSchool(request.authUser!.id);
    if (profile.schoolId !== input.schoolId) {
      throw new HttpError(403, "Requests can only be changed for your own school.");
    }
    const [row] = await requireDb()
      .update(assistanceRequestsTable)
      .set({
        title: input.title.trim(),
        category: input.category.trim(),
        item: input.item.trim(),
        description: input.description.trim(),
        specifications: input.specifications?.trim() || null,
        quantity: input.quantity,
        unit: input.unit.trim(),
        schoolContext: input.schoolContext.trim(),
        priority: input.priority,
        status: "PENDING_MODERATION",
        publishedAt: null,
        privateModerationNotes: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(assistanceRequestsTable.id, params.data.id),
          eq(assistanceRequestsTable.teacherUserId, request.authUser!.id),
          or(
            eq(assistanceRequestsTable.status, "PENDING_MODERATION"),
            eq(assistanceRequestsTable.status, "REJECTED"),
          ),
        ),
      )
      .returning();
    if (!row) throw new HttpError(404, "The request could not be changed.");
    response.json(
      Contract.UpdateRequestResponse.parse(toPublicRequest(row, profile.schoolName)),
    );
  },
);

router.delete(
  "/requests/:id",
  requireAuth,
  requireRole("TEACHER"),
  async (request, response) => {
    const params = Contract.DeleteRequestParams.safeParse(request.params);
    if (!params.success) {
      response.status(400).json({ error: "The request id is not valid." });
      return;
    }
    const [row] = await requireDb()
      .update(assistanceRequestsTable)
      .set({ status: "CANCELLED", updatedAt: new Date() })
      .where(
        and(
          eq(assistanceRequestsTable.id, params.data.id),
          eq(assistanceRequestsTable.teacherUserId, request.authUser!.id),
          eq(assistanceRequestsTable.status, "PENDING_MODERATION"),
        ),
      )
      .returning({ id: assistanceRequestsTable.id });
    if (!row) throw new HttpError(404, "The request could not be cancelled.");
    response.status(204).end();
  },
);

export default router;
