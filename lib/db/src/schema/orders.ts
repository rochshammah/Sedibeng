import {
  index,
  pgTable,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
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
