import { Router } from "express";
import { asc, eq } from "drizzle-orm";
import * as Contract from "@workspace/api-zod";
import { auditLogsTable, locationsTable, requireDb, serviceAreasTable, usersTable } from "@workspace/db";
import { requireAuth, requireRole } from "../../lib/auth-middleware";
import { HttpError } from "../../lib/errors";
import { activeLocationTree } from "../../lib/locations";
import { resolveServiceArea } from "../../lib/service-area";
import { parseBody } from "./shared";

const router = Router();

function isUniqueViolation(error: unknown) {
  const code = (error as { code?: string; cause?: { code?: string } })?.code ?? (error as { cause?: { code?: string } })?.cause?.code;
  return code === "23505";
}

// Public: the active locations people can choose from, grouped by service area.
router.get("/locations", async (_request, response) => {
  response.json(Contract.GetLocationsResponse.parse(await activeLocationTree()));
});

async function adminTree() {
  const rows = await requireDb()
    .select({
      areaId: serviceAreasTable.id,
      areaName: serviceAreasTable.name,
      areaActive: serviceAreasTable.isActive,
      locationId: locationsTable.id,
      locationName: locationsTable.name,
      locationActive: locationsTable.isActive,
    })
    .from(serviceAreasTable)
    .leftJoin(locationsTable, eq(locationsTable.serviceAreaId, serviceAreasTable.id))
    .orderBy(asc(serviceAreasTable.sortOrder), asc(serviceAreasTable.name), asc(locationsTable.sortOrder), asc(locationsTable.name));
  const areas = new Map<string, { id: string; name: string; isActive: boolean; locations: { id: string; name: string; isActive: boolean }[] }>();
  for (const row of rows) {
    const area = areas.get(row.areaId) ?? { id: row.areaId, name: row.areaName, isActive: row.areaActive, locations: [] };
    if (row.locationId) area.locations.push({ id: row.locationId, name: row.locationName!, isActive: row.locationActive! });
    areas.set(row.areaId, area);
  }
  return [...areas.values()];
}

router.get("/admin/locations", requireAuth, requireRole("ADMIN"), async (_request, response) => {
  response.json(Contract.ListAdminLocationsResponse.parse(await adminTree()));
});

async function audit(actorUserId: string, action: string, targetType: string, targetId: string) {
  await requireDb().insert(auditLogsTable).values({ actorUserId, action, targetType, targetId });
}

router.post("/admin/service-areas", requireAuth, requireRole("ADMIN"), async (request, response) => {
  const input = parseBody(Contract.CreateServiceAreaBody, request.body, response);
  if (!input) return;
  try {
    const [row] = await requireDb().insert(serviceAreasTable).values({ name: input.name.trim(), isActive: input.isActive, sortOrder: 100 }).returning();
    await audit(request.authUser!.id, "SERVICE_AREA_CREATED", "SERVICE_AREA", row.id);
    response.status(201).json(Contract.CreateServiceAreaResponse.parse({ id: row.id, name: row.name, isActive: row.isActive, locations: [] }));
  } catch (error) {
    if (isUniqueViolation(error)) throw new HttpError(409, "A service area with that name already exists.");
    throw error;
  }
});

router.patch("/admin/service-areas/:id", requireAuth, requireRole("ADMIN"), async (request, response) => {
  const params = Contract.UpdateServiceAreaParams.safeParse(request.params);
  const input = parseBody(Contract.UpdateServiceAreaBody, request.body, response);
  if (!params.success) {
    response.status(400).json({ error: "The service area id is not valid." });
    return;
  }
  if (!input) return;
  try {
    const [row] = await requireDb().update(serviceAreasTable).set({ name: input.name.trim(), isActive: input.isActive, updatedAt: new Date() }).where(eq(serviceAreasTable.id, params.data.id)).returning();
    if (!row) throw new HttpError(404, "That service area was not found.");
    await audit(request.authUser!.id, "SERVICE_AREA_UPDATED", "SERVICE_AREA", row.id);
    const tree = await adminTree();
    response.json(Contract.UpdateServiceAreaResponse.parse(tree.find((area) => area.id === row.id)));
  } catch (error) {
    if (isUniqueViolation(error)) throw new HttpError(409, "A service area with that name already exists.");
    throw error;
  }
});

router.post("/admin/locations/create", requireAuth, requireRole("ADMIN"), async (request, response) => {
  const input = parseBody(Contract.CreateLocationBody, request.body, response);
  if (!input) return;
  const [area] = await requireDb().select({ id: serviceAreasTable.id }).from(serviceAreasTable).where(eq(serviceAreasTable.id, input.serviceAreaId)).limit(1);
  if (!area) throw new HttpError(400, "Choose a service area for this location.");
  try {
    const [row] = await requireDb().insert(locationsTable).values({ name: input.name.trim(), serviceAreaId: area.id, isActive: input.isActive, sortOrder: 100 }).returning();
    await audit(request.authUser!.id, "LOCATION_CREATED", "LOCATION", row.id);
    response.status(201).json(Contract.CreateLocationResponse.parse({ id: row.id, name: row.name }));
  } catch (error) {
    if (isUniqueViolation(error)) throw new HttpError(409, "A location with that name already exists.");
    throw error;
  }
});

router.patch("/admin/locations/:id", requireAuth, requireRole("ADMIN"), async (request, response) => {
  const params = Contract.UpdateLocationParams.safeParse(request.params);
  const input = parseBody(Contract.UpdateLocationBody, request.body, response);
  if (!params.success) {
    response.status(400).json({ error: "The location id is not valid." });
    return;
  }
  if (!input) return;
  const [area] = await requireDb().select({ id: serviceAreasTable.id }).from(serviceAreasTable).where(eq(serviceAreasTable.id, input.serviceAreaId)).limit(1);
  if (!area) throw new HttpError(400, "Choose a service area for this location.");
  try {
    const [row] = await requireDb().update(locationsTable).set({ name: input.name.trim(), serviceAreaId: area.id, isActive: input.isActive, updatedAt: new Date() }).where(eq(locationsTable.id, params.data.id)).returning();
    if (!row) throw new HttpError(404, "That location was not found.");
    await audit(request.authUser!.id, "LOCATION_UPDATED", "LOCATION", row.id);
    response.json(Contract.UpdateLocationResponse.parse({ id: row.id, name: row.name }));
  } catch (error) {
    if (isUniqueViolation(error)) throw new HttpError(409, "A location with that name already exists.");
    throw error;
  }
});

// The area a person browses by default. This is a preference, not a permission.
router.get("/me/service-area", requireAuth, async (request, response) => {
  response.json(Contract.GetMyServiceAreaResponse.parse(await resolveServiceArea(request.authUser!)));
});

router.put("/me/service-area", requireAuth, async (request, response) => {
  const input = parseBody(Contract.SetMyServiceAreaBody, request.body, response);
  if (!input) return;
  if (input.serviceAreaId) {
    const [area] = await requireDb().select({ id: serviceAreasTable.id }).from(serviceAreasTable).where(eq(serviceAreasTable.id, input.serviceAreaId)).limit(1);
    if (!area) throw new HttpError(400, "That service area does not exist.");
  }
  // Only this one preference column is written; nothing else about the account can change here.
  await requireDb().update(usersTable).set({ preferredServiceAreaId: input.serviceAreaId, updatedAt: new Date() }).where(eq(usersTable.id, request.authUser!.id));
  response.json(Contract.SetMyServiceAreaResponse.parse(await resolveServiceArea(request.authUser!)));
});

export default router;
