import { createHash } from "node:crypto";
import express, { Router, type NextFunction, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { and, desc, eq, gt, inArray, ne, sql, type SQL } from "drizzle-orm";
import * as Contract from "@workspace/api-zod";
import {
  assistanceRequestsTable,
  auditLogsTable,
  donorInventoryTable,
  locationsTable,
  requireDb,
  serviceAreasTable,
  usersTable,
  verificationRecordsTable,
} from "@workspace/db";
import { requireAuth, requireRole } from "../../lib/auth-middleware";
import { categoryGroupOf } from "../../lib/categories";
import { HttpError } from "../../lib/errors";
import { findActiveLocation } from "../../lib/locations";
import { resolveServiceArea } from "../../lib/service-area";
import { PHOTO_KEY_PREFIX, getStorage, newPhotoKey } from "../../lib/storage";
import { MAX_DOCUMENT_BYTES, matchesMagicBytes, ALLOWED_DOCUMENT_TYPES } from "../../lib/uploads";
import { parseBody } from "./shared";

const router = Router();

const mutationLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 40,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_request, response) => response.status(429).json({ error: "Too many changes. Try again later." }),
});
const photoLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_request, response) => response.status(429).json({ error: "Too many uploads. Try again later." }),
});

// Photos are pictures of goods only: JPEG or PNG (never PDF or anything else).
const PHOTO_TYPES = ["image/jpeg", "image/png"] as const;

const offerCountSql = sql<number>`(select count(*)::int from sponsorships s where s.inventory_id = ${donorInventoryTable.id})`;
const pendingOfferCountSql = sql<number>`(select count(*)::int from sponsorships s where s.inventory_id = ${donorInventoryTable.id} and s.status = 'PENDING_TEACHER_REVIEW')`;

function photoVersionOf(key: string | null) {
  return key ? (key.split("/").pop()?.split(".")[0] ?? null) : null;
}

type InventoryRow = {
  item: typeof donorInventoryTable.$inferSelect;
  locationName: string | null;
  serviceAreaName: string | null;
  offerCount: number;
  pendingOfferCount: number;
};

function inventoryView({ item, locationName, serviceAreaName, offerCount, pendingOfferCount }: InventoryRow) {
  return {
    id: item.id,
    title: item.title,
    category: item.category,
    categoryGroup: item.categoryGroup,
    item: item.item,
    description: item.description,
    specifications: item.specifications,
    quantityAvailable: item.quantityAvailable,
    unit: item.unit,
    condition: item.condition,
    district: item.district,
    area: item.area,
    locationId: item.locationId,
    locationName,
    serviceAreaName,
    photoStatus: item.photoStatus,
    photoVersion: photoVersionOf(item.photoObjectKey),
    offerCount,
    pendingOfferCount,
    status: item.status,
    isSeedData: item.isSeedData,
  };
}

function inventorySelect(where: SQL | undefined) {
  return requireDb()
    .select({
      item: donorInventoryTable,
      locationName: locationsTable.name,
      serviceAreaName: serviceAreasTable.name,
      offerCount: offerCountSql,
      pendingOfferCount: pendingOfferCountSql,
    })
    .from(donorInventoryTable)
    .leftJoin(locationsTable, eq(donorInventoryTable.locationId, locationsTable.id))
    .leftJoin(serviceAreasTable, eq(locationsTable.serviceAreaId, serviceAreasTable.id))
    .where(where);
}

async function ownedView(donorId: string, id: string) {
  const [row] = await inventorySelect(and(eq(donorInventoryTable.id, id), eq(donorInventoryTable.donorUserId, donorId)));
  if (!row) throw new HttpError(404, "That item could not be found.");
  return inventoryView(row);
}

async function donorIsVerified(userId: string) {
  const [verified] = await requireDb()
    .select({ id: verificationRecordsTable.id })
    .from(verificationRecordsTable)
    .where(and(eq(verificationRecordsTable.userId, userId), eq(verificationRecordsTable.type, "DONOR"), eq(verificationRecordsTable.status, "VERIFIED")))
    .limit(1);
  return Boolean(verified);
}

type ItemInput = ReturnType<typeof Contract.CreateInventoryBody.parse>;

async function validatedValues(input: ItemInput) {
  const title = input.title.trim();
  if (title.length < 2) throw new HttpError(400, "Give the item a name.");
  const location = await findActiveLocation(input.locationId);
  if (!location) throw new HttpError(400, "Choose where the goods are available from the location list.");
  return {
    title,
    category: input.category.trim(),
    categoryGroup: categoryGroupOf(input.category),
    item: title,
    description: input.description.trim(),
    specifications: input.specifications?.trim() || null,
    quantityAvailable: input.quantityAvailable,
    unit: input.unit.trim(),
    condition: input.condition,
    locationId: location.id,
    // Kept for the older display fields; the structured location is what is matched on.
    district: location.name,
    area: null,
  };
}

// ---------------------------------------------------------------------------------------
// Donor: own goods
// ---------------------------------------------------------------------------------------
router.get("/inventory", requireAuth, requireRole("DONOR"), async (request, response) => {
  const rows = await inventorySelect(eq(donorInventoryTable.donorUserId, request.authUser!.id)).orderBy(desc(donorInventoryTable.createdAt));
  response.json(Contract.GetInventoryResponse.parse(rows.map(inventoryView)));
});

async function createMany(donorId: string, inputs: ItemInput[]) {
  const values: Awaited<ReturnType<typeof validatedValues>>[] = [];
  for (const input of inputs) values.push(await validatedValues(input));
  const verified = await donorIsVerified(donorId);
  const created = await requireDb().transaction(async (tx) => {
    const rows = await tx
      .insert(donorInventoryTable)
      .values(values.map((value) => ({ ...value, donorUserId: donorId, status: (verified ? "AVAILABLE" : "DRAFT") as "AVAILABLE" | "DRAFT" })))
      .returning({ id: donorInventoryTable.id });
    await tx.insert(auditLogsTable).values(rows.map((row) => ({ actorUserId: donorId, action: "GOODS_LISTED", targetType: "INVENTORY", targetId: row.id })));
    return rows;
  });
  const views = await inventorySelect(inArray(donorInventoryTable.id, created.map((row) => row.id)));
  // Return in the order submitted, so a client can attach each photo to the right item.
  const order = new Map(created.map((row, index) => [row.id, index]));
  return views.sort((a, b) => order.get(a.item.id)! - order.get(b.item.id)!).map(inventoryView);
}

router.post("/inventory", requireAuth, requireRole("DONOR"), mutationLimit, async (request, response) => {
  const input = parseBody(Contract.CreateInventoryBody, request.body, response);
  if (!input) return;
  const [created] = await createMany(request.authUser!.id, [input]);
  response.status(201).json(Contract.CreateInventoryResponse.parse(created));
});

router.post("/inventory/bulk", requireAuth, requireRole("DONOR"), mutationLimit, async (request, response) => {
  const input = parseBody(Contract.CreateInventoryBulkBody, request.body, response);
  if (!input) return;
  const created = await createMany(request.authUser!.id, input.items);
  response.status(201).json(Contract.CreateInventoryBulkResponse.parse(created));
});

router.patch("/inventory/:id", requireAuth, requireRole("DONOR"), mutationLimit, async (request, response) => {
  const params = Contract.UpdateInventoryParams.safeParse(request.params);
  const input = parseBody(Contract.UpdateInventoryBody, request.body, response);
  if (!params.success) {
    response.status(400).json({ error: "The inventory id is not valid." });
    return;
  }
  if (!input) return;
  const values = await validatedValues(input);
  // A fully reserved listing becomes available again when the donor adds more.
  const [row] = await requireDb()
    .update(donorInventoryTable)
    .set({
      ...values,
      status: sql`case when ${donorInventoryTable.status} = 'DRAFT' then 'DRAFT'::inventory_status else 'AVAILABLE'::inventory_status end`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(donorInventoryTable.id, params.data.id),
        eq(donorInventoryTable.donorUserId, request.authUser!.id),
        inArray(donorInventoryTable.status, ["DRAFT", "AVAILABLE", "RESERVED"]),
      ),
    )
    .returning({ id: donorInventoryTable.id });
  if (!row) throw new HttpError(404, "The inventory item could not be changed.");
  response.json(Contract.UpdateInventoryResponse.parse(await ownedView(request.authUser!.id, row.id)));
});

router.delete("/inventory/:id", requireAuth, requireRole("DONOR"), async (request, response) => {
  const params = Contract.DeleteInventoryParams.safeParse(request.params);
  if (!params.success) {
    response.status(400).json({ error: "The inventory id is not valid." });
    return;
  }
  const where = and(
    eq(donorInventoryTable.id, params.data.id),
    eq(donorInventoryTable.donorUserId, request.authUser!.id),
    inArray(donorInventoryTable.status, ["DRAFT", "AVAILABLE", "RESERVED"]),
  );
  const [current] = await requireDb().select({ key: donorInventoryTable.photoObjectKey }).from(donorInventoryTable).where(where).limit(1);
  const [row] = await requireDb()
    .update(donorInventoryTable)
    .set({ status: "WITHDRAWN", photoObjectKey: null, photoContentType: null, photoStatus: "NONE", updatedAt: new Date() })
    .where(where)
    .returning({ id: donorInventoryTable.id });
  if (!row) throw new HttpError(404, "The inventory item could not be withdrawn.");
  // Existing offers on this item continue; the listing just stops being offered.
  if (current?.key) await getStorage()?.remove(current.key).catch(() => undefined);
  response.status(204).end();
});

// ---------------------------------------------------------------------------------------
// Item photos (private storage, shown only after an administrator approves them)
// ---------------------------------------------------------------------------------------
function rawPhotoBody(request: Request, response: Response, next: NextFunction) {
  express.raw({ type: [...PHOTO_TYPES], limit: MAX_DOCUMENT_BYTES })(request, response, (error?: unknown) => {
    if (error) {
      const status = (error as { status?: number }).status;
      next(new HttpError(status === 413 ? 413 : 400, status === 413 ? "That photo is too large. The limit is 5 MB." : "The photo could not be read."));
      return;
    }
    next();
  });
}

router.post("/inventory/:id/photo", requireAuth, requireRole("DONOR"), photoLimit, rawPhotoBody, async (request, response) => {
  const storage = getStorage();
  if (!storage) throw new HttpError(503, "Photo storage is not configured on this server.");
  const params = Contract.UploadInventoryPhotoParams.safeParse(request.params);
  if (!params.success) {
    response.status(400).json({ error: "The inventory id is not valid." });
    return;
  }
  const declared = request.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (!declared || !(PHOTO_TYPES as readonly string[]).includes(declared)) {
    throw new HttpError(415, "Only JPEG or PNG photos can be uploaded.");
  }
  const body = request.body;
  if (!Buffer.isBuffer(body) || body.length === 0) throw new HttpError(400, "The photo is empty.");
  const type = declared as (typeof PHOTO_TYPES)[number];
  // The file's real bytes must match what it claims to be; a renamed file is refused.
  if (!matchesMagicBytes(body, type)) throw new HttpError(415, "That file does not look like a real JPEG or PNG photo.");

  const donorId = request.authUser!.id;
  const database = requireDb();
  const [current] = await database
    .select({ id: donorInventoryTable.id, key: donorInventoryTable.photoObjectKey, status: donorInventoryTable.status })
    .from(donorInventoryTable)
    .where(and(eq(donorInventoryTable.id, params.data.id), eq(donorInventoryTable.donorUserId, donorId)))
    .limit(1);
  if (!current || current.status === "WITHDRAWN") throw new HttpError(404, "That item could not be found.");

  const key = newPhotoKey(donorId, ALLOWED_DOCUMENT_TYPES[type].extension);
  await storage.put(key, body, type);
  try {
    await database
      .update(donorInventoryTable)
      .set({ photoObjectKey: key, photoContentType: type, photoStatus: "PENDING", updatedAt: new Date() })
      .where(eq(donorInventoryTable.id, current.id));
  } catch (error) {
    await storage.remove(key).catch(() => undefined);
    throw error;
  }
  if (current.key) await storage.remove(current.key).catch(() => undefined);
  await database.insert(auditLogsTable).values({
    actorUserId: donorId,
    action: "GOODS_PHOTO_UPLOADED",
    targetType: "INVENTORY",
    targetId: current.id,
    metadata: { sizeBytes: body.length, sha256: createHash("sha256").update(body).digest("hex").slice(0, 16) },
  });
  response.json(Contract.UploadInventoryPhotoResponse.parse(await ownedView(donorId, current.id)));
});

router.delete("/inventory/:id/photo", requireAuth, requireRole("DONOR"), async (request, response) => {
  const params = Contract.DeleteInventoryPhotoParams.safeParse(request.params);
  if (!params.success) {
    response.status(400).json({ error: "The inventory id is not valid." });
    return;
  }
  const donorId = request.authUser!.id;
  const [current] = await requireDb()
    .select({ id: donorInventoryTable.id, key: donorInventoryTable.photoObjectKey })
    .from(donorInventoryTable)
    .where(and(eq(donorInventoryTable.id, params.data.id), eq(donorInventoryTable.donorUserId, donorId)))
    .limit(1);
  if (!current) throw new HttpError(404, "That item could not be found.");
  await requireDb()
    .update(donorInventoryTable)
    .set({ photoObjectKey: null, photoContentType: null, photoStatus: "NONE", updatedAt: new Date() })
    .where(eq(donorInventoryTable.id, current.id));
  if (current.key) await getStorage()?.remove(current.key).catch(() => undefined);
  response.json(Contract.DeleteInventoryPhotoResponse.parse(await ownedView(donorId, current.id)));
});

// Serves a photo. Signed-in users only. The owner and administrators always; teachers only
// once an administrator has approved the photo and the goods are still on offer.
router.get("/inventory/:id/photo", requireAuth, async (request, response) => {
  const id = String(request.params.id);
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(404, "Photo not found.");
  const user = request.authUser!;
  const [row] = await requireDb()
    .select({
      donorUserId: donorInventoryTable.donorUserId,
      key: donorInventoryTable.photoObjectKey,
      contentType: donorInventoryTable.photoContentType,
      photoStatus: donorInventoryTable.photoStatus,
      status: donorInventoryTable.status,
    })
    .from(donorInventoryTable)
    .where(eq(donorInventoryTable.id, id))
    .limit(1);
  const isOwner = row?.donorUserId === user.id;
  const mayView =
    !!row &&
    (user.role === "ADMIN" ||
      isOwner ||
      (user.role === "TEACHER" && row.photoStatus === "APPROVED" && ["AVAILABLE", "RESERVED"].includes(row.status)));
  const storage = getStorage();
  // Only item photos are ever served here, never verification documents.
  if (!row || !mayView || !row.key || !row.key.startsWith(PHOTO_KEY_PREFIX) || !storage?.read) {
    throw new HttpError(404, "Photo not found.");
  }
  const bytes = await storage.read(row.key).catch(() => null);
  if (!bytes) throw new HttpError(404, "Photo not found.");
  response.set({
    "Content-Type": row.contentType ?? "image/jpeg",
    "Content-Disposition": "inline",
    "Cache-Control": "private, max-age=3600",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self'",
  });
  response.send(bytes);
});

// ---------------------------------------------------------------------------------------
// Teachers: goods available near them
// ---------------------------------------------------------------------------------------
router.get("/goods", requireAuth, requireRole("TEACHER", "ADMIN"), async (request, response) => {
  const query = Contract.GetGoodsQueryParams.safeParse(request.query);
  if (!query.success) {
    response.status(400).json({ error: "Those filters are not valid." });
    return;
  }
  const user = request.authUser!;
  const filters: SQL[] = [
    eq(donorInventoryTable.status, "AVAILABLE"),
    gt(donorInventoryTable.quantityAvailable, 0),
    eq(locationsTable.isActive, true),
    eq(serviceAreasTable.isActive, true),
  ];
  if (process.env.NODE_ENV === "production") filters.push(eq(donorInventoryTable.isSeedData, false));
  if (query.data.serviceAreaId) filters.push(eq(locationsTable.serviceAreaId, query.data.serviceAreaId));
  if (query.data.locationId) filters.push(eq(donorInventoryTable.locationId, query.data.locationId));
  if (query.data.categoryGroup) filters.push(eq(donorInventoryTable.categoryGroup, query.data.categoryGroup));

  const rows = await requireDb()
    .select({
      item: donorInventoryTable,
      locationName: locationsTable.name,
      serviceAreaId: serviceAreasTable.id,
      serviceAreaName: serviceAreasTable.name,
    })
    .from(donorInventoryTable)
    .innerJoin(locationsTable, eq(donorInventoryTable.locationId, locationsTable.id))
    .innerJoin(serviceAreasTable, eq(locationsTable.serviceAreaId, serviceAreasTable.id))
    .where(and(...filters))
    .orderBy(desc(donorInventoryTable.createdAt), desc(donorInventoryTable.id))
    .limit(query.data.limit ?? 30);

  // "Local" means: the same service area as one of the teacher's live requests, in a
  // relevant category. It is only a discovery hint, never a promise that goods suit a request.
  const mine = await resolveServiceArea(user);
  const wanted = new Set<string>();
  if (user.role === "TEACHER") {
    const live = await requireDb()
      .select({ areaId: locationsTable.serviceAreaId, group: assistanceRequestsTable.categoryGroup })
      .from(assistanceRequestsTable)
      .innerJoin(locationsTable, eq(assistanceRequestsTable.locationId, locationsTable.id))
      .where(and(eq(assistanceRequestsTable.teacherUserId, user.id), inArray(assistanceRequestsTable.status, ["OPEN", "PARTIALLY_MATCHED"])));
    for (const row of live) wanted.add(`${row.areaId}|${row.group}`);
  }
  response.json(
    Contract.GetGoodsResponse.parse(
      rows.map((row) => ({
        id: row.item.id,
        title: row.item.title,
        category: row.item.category,
        categoryGroup: row.item.categoryGroup,
        description: row.item.description,
        quantityAvailable: row.item.quantityAvailable,
        unit: row.item.unit,
        condition: row.item.condition,
        locationId: row.item.locationId,
        locationName: row.locationName,
        serviceAreaId: row.serviceAreaId,
        serviceAreaName: row.serviceAreaName,
        photoVersion: row.item.photoStatus === "APPROVED" ? photoVersionOf(row.item.photoObjectKey) : null,
        postedAt: row.item.createdAt.toISOString(),
        inMyServiceArea: mine.serviceAreaId !== null && row.serviceAreaId === mine.serviceAreaId,
        localMatch: wanted.has(`${row.serviceAreaId}|${row.item.categoryGroup}`),
      })),
    ),
  );
});

// ---------------------------------------------------------------------------------------
// Administrators: approve item photos
// ---------------------------------------------------------------------------------------
function reviewView(row: { id: string; title: string; category: string; donorName: string; locationName: string | null; key: string | null; createdAt: Date }) {
  return { id: row.id, title: row.title, category: row.category, donorName: row.donorName, locationName: row.locationName, photoVersion: photoVersionOf(row.key) ?? "", createdAt: row.createdAt.toISOString() };
}

router.get("/admin/goods-photos", requireAuth, requireRole("ADMIN"), async (_request, response) => {
  const rows = await requireDb()
    .select({
      id: donorInventoryTable.id,
      title: donorInventoryTable.title,
      category: donorInventoryTable.category,
      donorName: usersTable.name,
      locationName: locationsTable.name,
      key: donorInventoryTable.photoObjectKey,
      createdAt: donorInventoryTable.updatedAt,
    })
    .from(donorInventoryTable)
    .innerJoin(usersTable, eq(donorInventoryTable.donorUserId, usersTable.id))
    .leftJoin(locationsTable, eq(donorInventoryTable.locationId, locationsTable.id))
    .where(and(eq(donorInventoryTable.photoStatus, "PENDING"), ne(donorInventoryTable.status, "WITHDRAWN")))
    .orderBy(desc(donorInventoryTable.updatedAt))
    .limit(100);
  response.json(Contract.ListGoodsPhotosForReviewResponse.parse(rows.map(reviewView)));
});

router.post("/admin/goods-photos/:id/decision", requireAuth, requireRole("ADMIN"), async (request, response) => {
  const params = Contract.DecideGoodsPhotoParams.safeParse(request.params);
  const input = parseBody(Contract.DecideGoodsPhotoBody, request.body, response);
  if (!params.success) {
    response.status(400).json({ error: "The item id is not valid." });
    return;
  }
  if (!input) return;
  const approve = input.decision === "APPROVE";
  const [current] = await requireDb()
    .select({ key: donorInventoryTable.photoObjectKey })
    .from(donorInventoryTable)
    .where(and(eq(donorInventoryTable.id, params.data.id), eq(donorInventoryTable.photoStatus, "PENDING")))
    .limit(1);
  const [updated] = await requireDb()
    .update(donorInventoryTable)
    .set(approve ? { photoStatus: "APPROVED", updatedAt: new Date() } : { photoStatus: "REJECTED", photoObjectKey: null, photoContentType: null, updatedAt: new Date() })
    .where(and(eq(donorInventoryTable.id, params.data.id), eq(donorInventoryTable.photoStatus, "PENDING")))
    .returning({ id: donorInventoryTable.id, title: donorInventoryTable.title, category: donorInventoryTable.category, donorUserId: donorInventoryTable.donorUserId, createdAt: donorInventoryTable.updatedAt });
  if (!updated) throw new HttpError(404, "That photo is not waiting for review.");
  // A rejected photo is deleted from storage straight away.
  if (!approve && current?.key) await getStorage()?.remove(current.key).catch(() => undefined);
  await requireDb().insert(auditLogsTable).values({
    actorUserId: request.authUser!.id,
    action: approve ? "GOODS_PHOTO_APPROVED" : "GOODS_PHOTO_REJECTED",
    targetType: "INVENTORY",
    targetId: updated.id,
  });
  const [donor] = await requireDb().select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, updated.donorUserId)).limit(1);
  response.json(
    Contract.DecideGoodsPhotoResponse.parse(
      reviewView({ id: updated.id, title: updated.title, category: updated.category, donorName: donor?.name ?? "", locationName: null, key: approve ? current?.key ?? null : null, createdAt: updated.createdAt }),
    ),
  );
});

export default router;
