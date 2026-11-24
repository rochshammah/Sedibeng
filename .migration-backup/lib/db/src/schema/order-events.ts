import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import {
  orderEventTypeEnum,
  orderIssueTypeEnum,
  orderStatusEnum,
  userRoleEnum,
} from "./enums";
import { ordersTable } from "./orders";
import { usersTable } from "./users";

export const orderEventsTable = pgTable(
  "order_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => ordersTable.id, { onDelete: "cascade" }),
    actionId: uuid("action_id").notNull(),
    actorUserId: uuid("actor_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    actorRole: userRoleEnum("actor_role").notNull(),
    eventType: orderEventTypeEnum("event_type").notNull(),
    statusAfter: orderStatusEnum("status_after").notNull(),
    quantity: integer("quantity"),
    issueType: orderIssueTypeEnum("issue_type"),
    note: text("note"),
    privateNote: text("private_note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "order_events_quantity_positive",
      sql`${table.quantity} is null or ${table.quantity} > 0`,
    ),
    uniqueIndex("order_events_order_action_uidx").on(table.orderId, table.actionId),
    index("order_events_order_created_idx").on(table.orderId, table.createdAt),
  ],
);

export const insertOrderEventSchema = createInsertSchema(orderEventsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertOrderEvent = z.infer<typeof insertOrderEventSchema>;
export type OrderEvent = typeof orderEventsTable.$inferSelect;
