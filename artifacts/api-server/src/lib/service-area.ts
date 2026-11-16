import { and, desc, eq, ne } from "drizzle-orm";
import {
  donorInventoryTable,
  locationsTable,
  requireDb,
  schoolsTable,
  serviceAreasTable,
  teacherProfilesTable,
  usersTable,
} from "@workspace/db";

export type ServiceAreaChoice = {
  serviceAreaId: string | null;
  serviceAreaName: string | null;
  source: "CHOSEN" | "SCHOOL" | "YOUR_GOODS" | "NONE";
};

const none: ServiceAreaChoice = { serviceAreaId: null, serviceAreaName: null, source: "NONE" };

/**
 * The service area a person sees first. It is only a default: the person can always
 * switch to another area or to all areas.
 *   1. the area they chose themselves
 *   2. a teacher's school location
 *   3. a donor's most recent goods location
 */
export async function resolveServiceArea(user: { id: string; role: string }): Promise<ServiceAreaChoice> {
  const database = requireDb();
  const [chosen] = await database
    .select({ id: serviceAreasTable.id, name: serviceAreasTable.name })
    .from(usersTable)
    .innerJoin(serviceAreasTable, eq(usersTable.preferredServiceAreaId, serviceAreasTable.id))
    .where(and(eq(usersTable.id, user.id), eq(serviceAreasTable.isActive, true)))
    .limit(1);
  if (chosen) return { serviceAreaId: chosen.id, serviceAreaName: chosen.name, source: "CHOSEN" };

  if (user.role === "TEACHER") {
    const [fromSchool] = await database
      .select({ id: serviceAreasTable.id, name: serviceAreasTable.name })
      .from(teacherProfilesTable)
      .innerJoin(schoolsTable, eq(teacherProfilesTable.schoolId, schoolsTable.id))
      .innerJoin(locationsTable, eq(schoolsTable.locationId, locationsTable.id))
      .innerJoin(serviceAreasTable, eq(locationsTable.serviceAreaId, serviceAreasTable.id))
      .where(and(eq(teacherProfilesTable.userId, user.id), eq(serviceAreasTable.isActive, true)))
      .limit(1);
    if (fromSchool) return { serviceAreaId: fromSchool.id, serviceAreaName: fromSchool.name, source: "SCHOOL" };
  }
  if (user.role === "DONOR") {
    const [fromGoods] = await database
      .select({ id: serviceAreasTable.id, name: serviceAreasTable.name })
      .from(donorInventoryTable)
      .innerJoin(locationsTable, eq(donorInventoryTable.locationId, locationsTable.id))
      .innerJoin(serviceAreasTable, eq(locationsTable.serviceAreaId, serviceAreasTable.id))
      .where(and(eq(donorInventoryTable.donorUserId, user.id), ne(donorInventoryTable.status, "WITHDRAWN"), eq(serviceAreasTable.isActive, true)))
      .orderBy(desc(donorInventoryTable.createdAt))
      .limit(1);
    if (fromGoods) return { serviceAreaId: fromGoods.id, serviceAreaName: fromGoods.name, source: "YOUR_GOODS" };
  }
  return none;
}
