import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { inventoryStatusEnum, itemCategoryGroupEnum, photoStatusEnum } from "./enums";
import { locationsTable } from "./locations";
import { usersTable } from "./users";

export const donorInventoryTable = pgTable(
  "donor_inventory",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    donorUserId: uuid("donor_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    category: text("category").notNull(),
    item: text("item").notNull(),
    description: text("description").notNull(),
    specifications: text("specifications"),
    quantityAvailable: integer("quantity_available").notNull(),
    unit: text("unit").notNull(),
    district: text("district").notNull(),
    area: text("area"),
    categoryGroup: itemCategoryGroupEnum("category_group").notNull().default("OTHER"),
    locationId: uuid("location_id").references(() => locationsTable.id, { onDelete: "restrict" }),
    // NEW | GOOD | FAIR (validated by the API)
    condition: text("condition"),
    // Optional item photo. Stored privately (Cloudinary "item-photos" folder), shown only once approved.
    photoObjectKey: text("photo_object_key"),
    photoContentType: text("photo_content_type"),
    photoStatus: photoStatusEnum("photo_status").notNull().default("NONE"),
    status: inventoryStatusEnum("status").notNull().default("DRAFT"),
    isSeedData: boolean("is_seed_data").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    check(
      "donor_inventory_quantity_positive",
      sql`${table.quantityAvailable} >= 0`,
    ),
    index("donor_inventory_donor_status_idx").on(
      table.donorUserId,
      table.status,
    ),
    index("donor_inventory_discovery_idx").on(
      table.status,
      table.locationId,
      table.categoryGroup,
    ),
    index("donor_inventory_public_idx").on(
      table.status,
      table.district,
      table.category,
    ),
  ],
);

export const insertDonorInventorySchema = createInsertSchema(
  donorInventoryTable,
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  status: true,
  isSeedData: true,
});

export type InsertDonorInventory = z.infer<typeof insertDonorInventorySchema>;
export type DonorInventory = typeof donorInventoryTable.$inferSelect;
