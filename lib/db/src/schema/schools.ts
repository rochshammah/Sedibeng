import { sql } from "drizzle-orm";
import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { schoolStatusEnum } from "./enums";

export const schoolsTable = pgTable(
  "schools",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    district: text("district").notNull().default("Gaborone"),
    area: text("area"),
    countryCode: text("country_code").notNull().default("BW"),
    status: schoolStatusEnum("status").notNull().default("PENDING_REVIEW"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("schools_name_district_area_uidx").on(
      sql`lower(${table.name})`,
      sql`lower(${table.district})`,
      sql`lower(coalesce(${table.area}, ''))`,
    ),
    index("schools_district_area_idx").on(table.district, table.area),
    index("schools_status_idx").on(table.status),
  ],
);

export const insertSchoolSchema = createInsertSchema(schoolsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertSchool = z.infer<typeof insertSchoolSchema>;
export type School = typeof schoolsTable.$inferSelect;
