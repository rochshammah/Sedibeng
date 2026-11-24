import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { ordersTable } from "./orders";
import { usersTable } from "./users";

export const handoffMessagesTable = pgTable(
  "handoff_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => ordersTable.id, { onDelete: "cascade" }),
    senderUserId: uuid("sender_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "restrict" }),
    actionId: uuid("action_id").notNull(),
    body: varchar("body", { length: 1200 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "handoff_messages_body_nonempty",
      sql`length(btrim(${table.body})) > 0`,
    ),
    index("handoff_messages_order_created_idx").on(
      table.orderId,
      table.createdAt,
    ),
    uniqueIndex("handoff_messages_sender_action_uidx").on(
      table.senderUserId,
      table.actionId,
    ),
  ],
);

export const insertHandoffMessageSchema = createInsertSchema(
  handoffMessagesTable,
).omit({
  id: true,
  createdAt: true,
});

export type InsertHandoffMessage = z.infer<typeof insertHandoffMessageSchema>;
export type HandoffMessage = typeof handoffMessagesTable.$inferSelect;
