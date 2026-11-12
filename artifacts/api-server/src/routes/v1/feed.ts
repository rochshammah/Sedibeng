import { Router } from "express";
import {
  and,
  desc,
  eq,
  ilike,
  inArray,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import * as Contract from "@workspace/api-zod";
import {
  assistanceRequestsTable,
  requireDb,
  savedRequestsTable,
  schoolsTable,
  sponsorshipsTable,
} from "@workspace/db";
import { requireAuth, requireRole } from "../../lib/auth-middleware";
import { HttpError } from "../../lib/errors";
import { verifiedTeacherIds } from "../../lib/verification";
import {
  itemImage,
  likeTerm,
  priorityLabel,
  requestStatusLabel,
} from "./assistance";

const router = Router();

const PUBLIC_STATUSES = [
  "OPEN",
  "PARTIALLY_MATCHED",
  "MATCHED",
  "FULFILLED",
] as const;

// When a post "went live": the moderation approval time, else creation time.
const postedAtExpr = sql`coalesce(${assistanceRequestsTable.publishedAt}, ${assistanceRequestsTable.createdAt})`;

function encodeCursor(postedAt: string, id: string) {
  return Buffer.from(JSON.stringify({ t: postedAt, i: id })).toString(
    "base64url",
  );
}

function decodeCursor(value: string): { t: string; i: string } | null {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (
      typeof parsed?.t === "string" &&
      typeof parsed?.i === "string" &&
      !Number.isNaN(Date.parse(parsed.t)) &&
      /^[0-9a-f-]{36}$/i.test(parsed.i)
    ) {
      return { t: parsed.t, i: parsed.i };
    }
  } catch {
    // fall through
  }
  return null;
}

type FeedRow = {
  request: typeof assistanceRequestsTable.$inferSelect;
  schoolName: string;
  postedAtText: string;
};

// Decorate rows with progress numbers, the viewer's own offer and saved flag.
async function buildPosts(rows: FeedRow[], viewerId: string | undefined) {
  const db = requireDb();
  const ids = rows.map((row) => row.request.id);
  const covered = new Map<string, number>();
  const pending = new Map<string, number>();
  const mine = new Map<string, number>();
  const saved = new Set<string>();
  // The badge is shown only when the underlying verification records confirm it.
  const verifiedTeachers = await verifiedTeacherIds([...new Set(rows.map((row) => row.request.teacherUserId))]);

  if (ids.length > 0) {
    const sums = await db
      .select({
        requestId: sponsorshipsTable.requestId,
        covered: sql<number>`coalesce(sum(${sponsorshipsTable.quantity}) filter (where ${sponsorshipsTable.status} in ('APPROVED','FULFILLED')), 0)::int`,
        pending: sql<number>`coalesce(sum(${sponsorshipsTable.quantity}) filter (where ${sponsorshipsTable.status} = 'PENDING_TEACHER_REVIEW'), 0)::int`,
        mine: viewerId
          ? sql<number>`coalesce(sum(${sponsorshipsTable.quantity}) filter (where ${sponsorshipsTable.donorUserId} = ${viewerId} and ${sponsorshipsTable.status} in ('PENDING_TEACHER_REVIEW','APPROVED','FULFILLED')), 0)::int`
          : sql<number>`0`,
      })
      .from(sponsorshipsTable)
      .where(inArray(sponsorshipsTable.requestId, ids))
      .groupBy(sponsorshipsTable.requestId);
    for (const row of sums) {
      covered.set(row.requestId, row.covered);
      pending.set(row.requestId, row.pending);
      mine.set(row.requestId, row.mine);
    }
    if (viewerId) {
      const savedRows = await db
        .select({ requestId: savedRequestsTable.requestId })
        .from(savedRequestsTable)
        .where(
          and(
            eq(savedRequestsTable.userId, viewerId),
            inArray(savedRequestsTable.requestId, ids),
          ),
        );
      for (const row of savedRows) saved.add(row.requestId);
    }
  }

  return rows.map(({ request: row, schoolName, postedAtText }) => {
    const status = requestStatusLabel(row.status);
    const isFulfilled = status === "Fulfilled";
    return {
      id: row.id,
      title: row.title,
      category: row.category,
      item: row.item,
      description: row.description,
      quantity: row.quantity,
      unit: row.unit,
      location: [row.area, row.district].filter(Boolean).join(" · "),
      schoolName,
      priority: priorityLabel(row.priority),
      status: status as "Open" | "Partially matched" | "Matched" | "Fulfilled",
      imageUrl: itemImage(row.category),
      imageAlt: `${row.item} for a school assistance request`,
      size: row.size,
      conditionRequirement: row.conditionRequirement,
      requiredBy: row.requiredBy,
      teacherVerified: verifiedTeachers.has(row.teacherUserId),
      postedAt: new Date(postedAtText).toISOString(),
      quantityCovered: isFulfilled
        ? row.quantity
        : Math.min(covered.get(row.id) ?? 0, row.quantity),
      quantityPending: pending.get(row.id) ?? 0,
      myOfferQuantity: mine.get(row.id) ?? 0,
      isSaved: saved.has(row.id),
      isSeedData: row.isSeedData,
    };
  });
}

function baseFilters(): SQL[] {
  const filters: SQL[] = [
    inArray(assistanceRequestsTable.status, [...PUBLIC_STATUSES]),
  ];
  if (process.env.NODE_ENV === "production") {
    filters.push(eq(assistanceRequestsTable.isSeedData, false));
  }
  return filters;
}

router.get("/feed", async (request, response) => {
  const query = Contract.GetFeedQueryParams.safeParse(request.query);
  if (!query.success) {
    response.status(400).json({ error: "Feed filters are not valid." });
    return;
  }
  const limit = query.data.limit ?? 10;
  const filters = baseFilters();

  if (query.data.cursor) {
    const cursor = decodeCursor(query.data.cursor);
    if (!cursor) {
      response.status(400).json({ error: "The feed position is not valid." });
      return;
    }
    filters.push(
      sql`(${postedAtExpr}, ${assistanceRequestsTable.id}) < (${cursor.t}::timestamptz, ${cursor.i}::uuid)`,
    );
  }
  if (query.data.category) {
    // One category, or a short comma-separated group (e.g. "Textbooks,Exercise books").
    const names = query.data.category.split(",").map((name) => name.trim()).filter(Boolean).slice(0, 10);
    if (names.length > 0) filters.push(inArray(assistanceRequestsTable.category, names));
  }
  if (query.data.priority) {
    const normalized = query.data.priority.toUpperCase();
    if (["STANDARD", "HIGH", "ESSENTIAL"].includes(normalized)) {
      filters.push(
        eq(
          assistanceRequestsTable.priority,
          normalized as "STANDARD" | "HIGH" | "ESSENTIAL",
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
        ilike(assistanceRequestsTable.area, term),
        ilike(schoolsTable.name, term),
      )!,
    );
  }

  const rows = await requireDb()
    .select({
      request: assistanceRequestsTable,
      schoolName: schoolsTable.name,
      postedAtText: sql<string>`${postedAtExpr}::text`,
    })
    .from(assistanceRequestsTable)
    .innerJoin(schoolsTable, eq(assistanceRequestsTable.schoolId, schoolsTable.id))
    .where(and(...filters))
    .orderBy(desc(postedAtExpr), desc(assistanceRequestsTable.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const last = pageRows[pageRows.length - 1];
  const items = await buildPosts(pageRows, request.authUser?.id);

  response.json(
    Contract.GetFeedResponse.parse({
      items,
      nextCursor:
        hasMore && last ? encodeCursor(last.postedAtText, last.request.id) : null,
    }),
  );
});

router.get(
  "/saved",
  requireAuth,
  requireRole("DONOR"),
  async (request, response) => {
    const rows = await requireDb()
      .select({
        request: assistanceRequestsTable,
        schoolName: schoolsTable.name,
        postedAtText: sql<string>`${postedAtExpr}::text`,
      })
      .from(savedRequestsTable)
      .innerJoin(
        assistanceRequestsTable,
        eq(savedRequestsTable.requestId, assistanceRequestsTable.id),
      )
      .innerJoin(schoolsTable, eq(assistanceRequestsTable.schoolId, schoolsTable.id))
      .where(
        and(
          eq(savedRequestsTable.userId, request.authUser!.id),
          ...baseFilters(),
        ),
      )
      .orderBy(desc(savedRequestsTable.createdAt))
      .limit(100);
    const items = await buildPosts(rows, request.authUser!.id);
    response.json(Contract.GetSavedRequestsResponse.parse(items));
  },
);

router.put(
  "/requests/:id/save",
  requireAuth,
  requireRole("DONOR"),
  async (request, response) => {
    const params = Contract.SaveRequestParams.safeParse(request.params);
    if (!params.success) {
      response.status(400).json({ error: "The request id is not valid." });
      return;
    }
    const db = requireDb();
    const [target] = await db
      .select({ id: assistanceRequestsTable.id })
      .from(assistanceRequestsTable)
      .where(
        and(
          eq(assistanceRequestsTable.id, params.data.id),
          inArray(assistanceRequestsTable.status, [...PUBLIC_STATUSES]),
        ),
      )
      .limit(1);
    if (!target) throw new HttpError(404, "That request could not be found.");
    await db
      .insert(savedRequestsTable)
      .values({ userId: request.authUser!.id, requestId: target.id })
      .onConflictDoNothing();
    response.json(
      Contract.SaveRequestResponse.parse({ requestId: target.id, isSaved: true }),
    );
  },
);

router.delete(
  "/requests/:id/save",
  requireAuth,
  requireRole("DONOR"),
  async (request, response) => {
    const params = Contract.UnsaveRequestParams.safeParse(request.params);
    if (!params.success) {
      response.status(400).json({ error: "The request id is not valid." });
      return;
    }
    await requireDb()
      .delete(savedRequestsTable)
      .where(
        and(
          eq(savedRequestsTable.userId, request.authUser!.id),
          eq(savedRequestsTable.requestId, params.data.id),
        ),
      );
    response.json(
      Contract.UnsaveRequestResponse.parse({
        requestId: params.data.id,
        isSaved: false,
      }),
    );
  },
);

export default router;
