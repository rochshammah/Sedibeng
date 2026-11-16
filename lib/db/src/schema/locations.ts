import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// A service area groups nearby locations (e.g. Greater Gaborone). Goods and requests
// are suggested to each other only inside one service area.
export const serviceAreasTable = pgTable(
  "service_areas",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex("service_areas_name_uidx").on(sql`lower(${table.name})`)],
);

// A selectable place (town or suburb). Always matched by id, never by its name text.
export const locationsTable = pgTable(
  "locations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    serviceAreaId: uuid("service_area_id")
      .notNull()
      .references(() => serviceAreasTable.id, { onDelete: "restrict" }),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("locations_name_uidx").on(sql`lower(${table.name})`),
    index("locations_service_area_idx").on(table.serviceAreaId),
  ],
);

export type ServiceArea = typeof serviceAreasTable.$inferSelect;
export type Location = typeof locationsTable.$inferSelect;
