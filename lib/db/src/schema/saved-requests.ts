import { index, pgTable, primaryKey, timestamp, uuid } from "drizzle-orm/pg-core";
import { assistanceRequestsTable } from "./assistance-requests";
import { usersTable } from "./users";

export const savedRequestsTable = pgTable(
  "saved_requests",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    requestId: uuid("request_id")
      .notNull()
      .references(() => assistanceRequestsTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.requestId] }),
    index("saved_requests_user_idx").on(table.userId, table.createdAt),
  ],
);

export type SavedRequestRow = typeof savedRequestsTable.$inferSelect;
