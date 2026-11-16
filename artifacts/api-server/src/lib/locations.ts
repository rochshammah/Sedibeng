import { and, asc, eq, inArray } from "drizzle-orm";
import { locationsTable, requireDb, serviceAreasTable } from "@workspace/db";

export type LocationInfo = {
  id: string;
  name: string;
  serviceAreaId: string;
  serviceAreaName: string;
};

/** An ACTIVE location with its service area, or null if it does not exist or is switched off. */
export async function findActiveLocation(id: string): Promise<LocationInfo | null> {
  const [row] = await requireDb()
    .select({
      id: locationsTable.id,
      name: locationsTable.name,
      serviceAreaId: serviceAreasTable.id,
      serviceAreaName: serviceAreasTable.name,
    })
    .from(locationsTable)
    .innerJoin(serviceAreasTable, eq(locationsTable.serviceAreaId, serviceAreasTable.id))
    .where(and(eq(locationsTable.id, id), eq(locationsTable.isActive, true), eq(serviceAreasTable.isActive, true)))
    .limit(1);
  return row ?? null;
}

/** Active service areas with their active locations, in display order. */
export async function activeLocationTree() {
  const rows = await requireDb()
    .select({
      areaId: serviceAreasTable.id,
      areaName: serviceAreasTable.name,
      locationId: locationsTable.id,
      locationName: locationsTable.name,
    })
    .from(locationsTable)
    .innerJoin(serviceAreasTable, eq(locationsTable.serviceAreaId, serviceAreasTable.id))
    .where(and(eq(locationsTable.isActive, true), eq(serviceAreasTable.isActive, true)))
    .orderBy(asc(serviceAreasTable.sortOrder), asc(serviceAreasTable.name), asc(locationsTable.sortOrder), asc(locationsTable.name));
  const areas = new Map<string, { id: string; name: string; locations: { id: string; name: string }[] }>();
  for (const row of rows) {
    const area = areas.get(row.areaId) ?? { id: row.areaId, name: row.areaName, locations: [] };
    area.locations.push({ id: row.locationId, name: row.locationName });
    areas.set(row.areaId, area);
  }
  return [...areas.values()];
}

export type Place = { locationId: string; locationName: string; serviceAreaId: string; serviceAreaName: string };

/** Location details for response building (inactive places still display, they just cannot be newly chosen). */
export async function placeMap(locationIds: (string | null | undefined)[]): Promise<Map<string, Place>> {
  const ids = [...new Set(locationIds.filter((id): id is string => !!id))];
  const map = new Map<string, Place>();
  if (ids.length === 0) return map;
  const rows = await requireDb()
    .select({
      locationId: locationsTable.id,
      locationName: locationsTable.name,
      serviceAreaId: serviceAreasTable.id,
      serviceAreaName: serviceAreasTable.name,
    })
    .from(locationsTable)
    .innerJoin(serviceAreasTable, eq(locationsTable.serviceAreaId, serviceAreasTable.id))
    .where(inArray(locationsTable.id, ids));
  for (const row of rows) map.set(row.locationId, row);
  return map;
}
