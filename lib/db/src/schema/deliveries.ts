import {
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { deliveryStatusEnum } from "./enums";
import { ordersTable } from "./orders";

export const deliveriesTable = pgTable(
  "deliveries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .unique()
      .references(() => ordersTable.id, { onDelete: "cascade" }),
    status: deliveryStatusEnum("status").notNull().default("PLANNED"),
    generalArea: text("general_area"),
    handoffNotes: text("handoff_notes"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("deliveries_status_scheduled_idx").on(
      table.status,
      table.scheduledAt,
    ),
  ],
);

export const insertDeliverySchema = createInsertSchema(deliveriesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  status: true,
  completedAt: true,
});

export type InsertDelivery = z.infer<typeof insertDeliverySchema>;
export type Delivery = typeof deliveriesTable.$inferSelect;
