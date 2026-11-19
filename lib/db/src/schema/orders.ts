import {
  index,
  check,
  integer,
  pgTable,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { orderStatusEnum } from "./enums";
import { sponsorshipsTable } from "./sponsorships";

export const ordersTable = pgTable(
  "orders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sponsorshipId: uuid("sponsorship_id")
      .notNull()
      .unique()
      .references(() => sponsorshipsTable.id, { onDelete: "restrict" }),
    status: orderStatusEnum("status")
      .notNull()
      .default("AWAITING_TEACHER_APPROVAL"),
    handedOverQuantity: integer("handed_over_quantity").notNull().default(0),
    receivedQuantity: integer("received_quantity").notNull().default(0),
    distributedQuantity: integer("distributed_quantity").notNull().default(0),
    expectedHandoffAt: timestamp("expected_handoff_at", {
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    check("orders_handed_over_nonnegative", sql`${table.handedOverQuantity} >= 0`),
    check("orders_received_nonnegative", sql`${table.receivedQuantity} >= 0`),
    check("orders_distributed_nonnegative", sql`${table.distributedQuantity} >= 0`),
    check(
      "orders_received_lte_handed_over",
      sql`${table.receivedQuantity} <= ${table.handedOverQuantity}`,
    ),
    check(
      "orders_distributed_lte_received",
      sql`${table.distributedQuantity} <= ${table.receivedQuantity}`,
    ),
    index("orders_status_created_idx").on(table.status, table.createdAt),
  ],
);

export const insertOrderSchema = createInsertSchema(ordersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  status: true,
});

export type InsertOrder = z.infer<typeof insertOrderSchema>;
export type Order = typeof ordersTable.$inferSelect;
