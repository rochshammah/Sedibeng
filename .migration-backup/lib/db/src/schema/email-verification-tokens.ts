import {
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const emailVerificationTokensTable = pgTable(
  "email_verification_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("email_verification_user_created_idx").on(
      table.userId,
      table.createdAt,
    ),
    index("email_verification_expires_idx").on(table.expiresAt),
  ],
);

export const insertEmailVerificationTokenSchema = createInsertSchema(
  emailVerificationTokensTable,
).omit({ id: true, createdAt: true, consumedAt: true });

export type InsertEmailVerificationToken = z.infer<
  typeof insertEmailVerificationTokenSchema
>;
export type EmailVerificationToken =
  typeof emailVerificationTokensTable.$inferSelect;
