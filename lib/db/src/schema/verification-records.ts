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
import { verificationStatusEnum, verificationTypeEnum } from "./enums";

export const verificationRecordsTable = pgTable(
  "verification_records",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    reviewedBy: uuid("reviewed_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    type: verificationTypeEnum("type").notNull(),
    status: verificationStatusEnum("status").notNull().default("PENDING"),
    documentObjectKey: text("document_object_key"),
    privateReviewNotes: text("private_review_notes"),
    submittedAt: timestamp("submitted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("verification_records_user_status_idx").on(table.userId, table.status),
    index("verification_records_status_created_idx").on(
      table.status,
      table.createdAt,
    ),
  ],
);

export const insertVerificationRecordSchema = createInsertSchema(
  verificationRecordsTable,
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertVerificationRecord = z.infer<
  typeof insertVerificationRecordSchema
>;
export type VerificationRecord = typeof verificationRecordsTable.$inferSelect;
