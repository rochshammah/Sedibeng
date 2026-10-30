import { and, eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { db, isDatabaseConfigured, requireDb } from "./index";
import {
  assistanceRequestsTable,
  donorInventoryTable,
  schoolsTable,
  usersTable,
} from "./schema";

if (process.env.NODE_ENV !== "development") {
  throw new Error("Development seed data can only be loaded with NODE_ENV=development.");
}

if (!isDatabaseConfigured || !db) {
  throw new Error("Set NEON_DATABASE_URL before loading development seed data.");
}

const database = requireDb();
const seedTeacherId = "7f8e1a36-9c27-4f0c-9b65-10a0d8ac0101";
const seedSchoolId = "7f8e1a36-9c27-4f0c-9b65-10a0d8ac0102";
const seedRequestOneId = "7f8e1a36-9c27-4f0c-9b65-10a0d8ac0103";
const seedRequestTwoId = "7f8e1a36-9c27-4f0c-9b65-10a0d8ac0104";
const seedInventoryId = "7f8e1a36-9c27-4f0c-9b65-10a0d8ac0105";

const existingUser = await database
  .select({ id: usersTable.id })
  .from(usersTable)
  .where(eq(usersTable.id, seedTeacherId))
  .limit(1);

if (existingUser.length === 0) {
  await database.insert(usersTable).values({
    id: seedTeacherId,
    name: "Development sample account",
    email: "seed-teacher@sedibeng.invalid",
    passwordHash: `seed-only$${randomBytes(48).toString("hex")}`,
    role: "TEACHER",
    status: "SUSPENDED",
  });
}

const existingSchool = await database
  .select({ id: schoolsTable.id })
  .from(schoolsTable)
  .where(eq(schoolsTable.id, seedSchoolId))
  .limit(1);

if (existingSchool.length === 0) {
  await database.insert(schoolsTable).values({
    id: seedSchoolId,
    name: "Example School (Development)",
    district: "Gaborone",
    area: "Development sample",
    status: "ACTIVE",
  });
}

const requestSeeds = [
  {
    id: seedRequestOneId,
    title: "Reading books for a classroom",
    category: "Books",
    item: "Age-appropriate reading books",
    description: "Development sample request for catalogue and matching checks.",
    specifications: "Mixed early-reader titles",
    quantity: 24,
    unit: "books",
    schoolContext: "Development sample record. Not a real school request.",
  },
  {
    id: seedRequestTwoId,
    title: "Reusable classroom stationery",
    category: "Stationery",
    item: "Exercise books and pencils",
    description: "Development sample request for catalogue and matching checks.",
    specifications: "Standard classroom supplies",
    quantity: 30,
    unit: "sets",
    schoolContext: "Development sample record. Not a real school request.",
  },
] as const;

for (const request of requestSeeds) {
  const existing = await database
    .select({ id: assistanceRequestsTable.id })
    .from(assistanceRequestsTable)
    .where(eq(assistanceRequestsTable.id, request.id))
    .limit(1);

  if (existing.length === 0) {
    await database.insert(assistanceRequestsTable).values({
      ...request,
      teacherUserId: seedTeacherId,
      schoolId: seedSchoolId,
      district: "Gaborone",
      area: "Development sample",
      priority: "STANDARD",
      status: "OPEN",
      isSeedData: true,
      publishedAt: new Date(),
    });
  }
}

const existingInventory = await database
  .select({ id: donorInventoryTable.id })
  .from(donorInventoryTable)
  .where(
    and(
      eq(donorInventoryTable.id, seedInventoryId),
      eq(donorInventoryTable.donorUserId, seedTeacherId),
    ),
  )
  .limit(1);

if (existingInventory.length === 0) {
  await database.insert(donorInventoryTable).values({
    id: seedInventoryId,
    donorUserId: seedTeacherId,
    title: "Development sample pencils",
    category: "Stationery",
    item: "Pencils",
    description: "Development-only catalogue sample.",
    quantityAvailable: 40,
    unit: "pencils",
    district: "Gaborone",
    area: "Development sample",
    status: "AVAILABLE",
    isSeedData: true,
  });
}

console.info("Development sample data is ready.");
