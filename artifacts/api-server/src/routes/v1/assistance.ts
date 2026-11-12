import { Router } from "express";
import rateLimit from "express-rate-limit";
import { and, desc, eq, ilike, inArray, or } from "drizzle-orm";
import * as Contract from "@workspace/api-zod";
import {
  assistanceRequestsTable,
  requireDb,
  schoolsTable,
  teacherProfilesTable,
} from "@workspace/db";
import { requireAuth, requireRole } from "../../lib/auth-middleware";
import { HttpError } from "../../lib/errors";
import { getTeacherEligibility } from "../../lib/verification";
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

export function likeTerm(value: string) {
  return `%${value.replace(/[\\%_]/g, "\\$&")}%`;
}

export function priorityLabel(priority: string): "Essential" | "High" | "Standard" {
  if (priority === "ESSENTIAL") return "Essential";
  if (priority === "HIGH") return "High";
  return "Standard";
}

export function requestStatusLabel(
  status: string,
):
  | "Draft"
  | "Pending moderation"
  | "Needs changes"
  | "Open"
  | "Partially matched"
  | "Matched"
  | "Rejected"
  | "Cancelled"
  | "Fulfilled" {
  if (status === "DRAFT") return "Draft";
  if (status === "PENDING_MODERATION") return "Pending moderation";
  if (status === "NEEDS_MORE_INFORMATION") return "Needs changes";
  if (status === "PARTIALLY_MATCHED") return "Partially matched";
  if (status === "MATCHED") return "Matched";
  if (status === "REJECTED") return "Rejected";
  if (status === "CANCELLED") return "Cancelled";
  if (status === "FULFILLED") return "Fulfilled";
  return "Open";
}

export function itemImage(category: string) {
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

export function toPublicRequest(
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
    size: row.size,
    conditionRequirement: row.conditionRequirement,
    requiredBy: row.requiredBy,
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

// Only ever returned to the teacher who owns the request (never in public lists).
function toOwnRequest(row: typeof assistanceRequestsTable.$inferSelect, schoolName?: string) {
  return {
    ...toPublicRequest(row, schoolName),
    moderationFeedback: row.moderationFeedback,
    teacherPrivateNotes: row.teacherPrivateNotes,
  };
}

const EDITABLE_STATUSES = ["DRAFT", "PENDING_MODERATION", "REJECTED", "NEEDS_MORE_INFORMATION"] as const;

function requestColumns(input: ReturnType<typeof Contract.CreateRequestBody.parse>) {
  return {
    title: input.title.trim(),
    category: input.category.trim(),
    item: input.item.trim(),
    description: input.description.trim(),
    specifications: input.specifications?.trim() || null,
    size: input.size?.trim() || null,
    conditionRequirement: input.conditionRequirement ?? null,
    requiredBy: input.requiredBy ? input.requiredBy.toISOString().slice(0, 10) : null,
    teacherPrivateNotes: input.teacherPrivateNotes?.trim() || null,
    quantity: input.quantity,
    unit: input.unit.trim(),
    schoolContext: input.schoolContext.trim(),
    priority: input.priority,
  };
}

// The publishing rule, enforced here on the server: BOTH identity and professional
// verification must be confirmed (and the school confirmed in the directory).
async function assertCanSubmitForReview(userId: string, schoolId: string) {
  const eligibility = await getTeacherEligibility(userId);
  if (!eligibility.eligible || eligibility.schoolId !== schoolId) {
    throw new HttpError(
      403,
      `Complete both verification steps before sending a request for review. ${eligibility.reasons[0] ?? ""}`.trim(),
    );
  }
}

// Look the request up first so someone else's request is simply "not found",
// whatever the caller's verification state.
async function requireOwnedRequest(userId: string, requestId: string, statuses: readonly string[]) {
  const [owned] = await requireDb()
    .select({ id: assistanceRequestsTable.id, status: assistanceRequestsTable.status })
    .from(assistanceRequestsTable)
    .where(and(eq(assistanceRequestsTable.id, requestId), eq(assistanceRequestsTable.teacherUserId, userId)))
    .limit(1);
  if (!owned || !statuses.includes(owned.status)) throw new HttpError(404, "The request could not be changed.");
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
  const publicVisibility = or(
    eq(assistanceRequestsTable.status, "OPEN"),
    eq(assistanceRequestsTable.status, "PARTIALLY_MATCHED"),
    eq(assistanceRequestsTable.status, "MATCHED"),
    eq(assistanceRequestsTable.status, "FULFILLED"),
  );
  const visibility =
    request.authUser?.role === "ADMIN"
      ? undefined
      : request.authUser?.role === "TEACHER"
        ? or(
            publicVisibility,
            eq(assistanceRequestsTable.teacherUserId, request.authUser.id),
          )
        : publicVisibility;
  const filters = [visibility];
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
    .select({
      request: assistanceRequestsTable,
      schoolName: schoolsTable.name,
    })
    .from(assistanceRequestsTable)
    .innerJoin(schoolsTable, eq(assistanceRequestsTable.schoolId, schoolsTable.id))
    .where(and(...filters))
    .orderBy(desc(assistanceRequestsTable.priority), desc(assistanceRequestsTable.createdAt))
    .limit(100);
  response.json(
    Contract.GetRequestsResponse.parse(
      rows.map(({ request: row, schoolName }) => toPublicRequest(row, schoolName)),
    ),
  );
});

router.get("/requests/:id", async (request, response) => {
  const params = Contract.GetRequestParams.safeParse(request.params);
  if (!params.success) {
    response.status(400).json({ error: "The request id is not valid." });
    return;
  }
  const publicVisibility = or(
    eq(assistanceRequestsTable.status, "OPEN"),
    eq(assistanceRequestsTable.status, "PARTIALLY_MATCHED"),
    eq(assistanceRequestsTable.status, "MATCHED"),
    eq(assistanceRequestsTable.status, "FULFILLED"),
  );
  const visibility =
    request.authUser?.role === "ADMIN"
      ? undefined
      : request.authUser?.role === "TEACHER"
        ? or(
            publicVisibility,
            eq(assistanceRequestsTable.teacherUserId, request.authUser.id),
          )
        : publicVisibility;
  const [row] = await requireDb()
    .select()
    .from(assistanceRequestsTable)
    .where(
      and(
        eq(assistanceRequestsTable.id, params.data.id),
        visibility,
        request.authUser?.role === "ADMIN" ||
          request.authUser?.role === "TEACHER"
          ? undefined
          : or(
              eq(assistanceRequestsTable.status, "OPEN"),
              eq(assistanceRequestsTable.status, "PARTIALLY_MATCHED"),
              eq(assistanceRequestsTable.status, "MATCHED"),
              eq(assistanceRequestsTable.status, "FULFILLED"),
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
    if (profile.schoolId !== input.schoolId) {
      throw new HttpError(403, "Requests can only be created for your own school.");
    }
    const submit = input.submit !== false;
    // Drafts can be saved at any time; sending for review needs full verification.
    if (submit) await assertCanSubmitForReview(request.authUser!.id, profile.schoolId);

    const [row] = await requireDb()
      .insert(assistanceRequestsTable)
      .values({
        ...requestColumns(input),
        teacherUserId: request.authUser!.id,
        schoolId: profile.schoolId,
        district: profile.district,
        area: profile.area,
        status: submit ? "PENDING_MODERATION" : "DRAFT",
        isSeedData: false,
      })
      .returning();
    response.status(201).json(
      Contract.CreateRequestResponse.parse(toPublicRequest(row, profile.schoolName)),
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
    await requireOwnedRequest(request.authUser!.id, params.data.id, EDITABLE_STATUSES);
    const submit = input.submit !== false;
    if (submit) await assertCanSubmitForReview(request.authUser!.id, profile.schoolId);
    const [row] = await requireDb()
      .update(assistanceRequestsTable)
      .set({
        ...requestColumns(input),
        status: submit ? "PENDING_MODERATION" : "DRAFT",
        publishedAt: null,
        privateModerationNotes: null,
        // Feedback stays visible on a draft until the teacher sends the request again.
        ...(submit ? { moderationFeedback: null } : {}),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(assistanceRequestsTable.id, params.data.id),
          eq(assistanceRequestsTable.teacherUserId, request.authUser!.id),
          inArray(assistanceRequestsTable.status, [...EDITABLE_STATUSES]),
        ),
      )
      .returning();
    if (!row) throw new HttpError(404, "The request could not be changed.");
    response.json(
      Contract.UpdateRequestResponse.parse(toPublicRequest(row, profile.schoolName)),
    );
  },
);

router.post(
  "/requests/:id/submit",
  requireAuth,
  requireRole("TEACHER"),
  async (request, response) => {
    const params = Contract.SubmitRequestParams.safeParse(request.params);
    if (!params.success) {
      response.status(400).json({ error: "The request id is not valid." });
      return;
    }
    const profile = await findProfileSchool(request.authUser!.id);
    await requireOwnedRequest(request.authUser!.id, params.data.id, ["DRAFT", "REJECTED", "NEEDS_MORE_INFORMATION"]);
    await assertCanSubmitForReview(request.authUser!.id, profile.schoolId);
    const [row] = await requireDb()
      .update(assistanceRequestsTable)
      .set({ status: "PENDING_MODERATION", moderationFeedback: null, publishedAt: null, updatedAt: new Date() })
      .where(
        and(
          eq(assistanceRequestsTable.id, params.data.id),
          eq(assistanceRequestsTable.teacherUserId, request.authUser!.id),
          inArray(assistanceRequestsTable.status, ["DRAFT", "REJECTED", "NEEDS_MORE_INFORMATION"]),
        ),
      )
      .returning();
    if (!row) throw new HttpError(404, "That request cannot be sent for review.");
    response.json(Contract.SubmitRequestResponse.parse(toOwnRequest(row, profile.schoolName)));
  },
);

router.get(
  "/teacher/requests",
  requireAuth,
  requireRole("TEACHER"),
  async (request, response) => {
    const rows = await requireDb()
      .select({ request: assistanceRequestsTable, schoolName: schoolsTable.name })
      .from(assistanceRequestsTable)
      .innerJoin(schoolsTable, eq(assistanceRequestsTable.schoolId, schoolsTable.id))
      .where(eq(assistanceRequestsTable.teacherUserId, request.authUser!.id))
      .orderBy(desc(assistanceRequestsTable.createdAt))
      .limit(200);
    response.json(
      Contract.GetMyRequestsResponse.parse(rows.map((row) => toOwnRequest(row.request, row.schoolName))),
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
          inArray(assistanceRequestsTable.status, ["DRAFT", "PENDING_MODERATION", "NEEDS_MORE_INFORMATION"]),
        ),
      )
      .returning({ id: assistanceRequestsTable.id });
    if (!row) throw new HttpError(404, "The request could not be cancelled.");
    response.status(204).end();
  },
);

export default router;
