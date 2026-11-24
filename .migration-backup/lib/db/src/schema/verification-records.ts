import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import {
  verificationDocumentTypeEnum,
  verificationStageEnum,
  verificationStatusEnum,
  verificationTypeEnum,
} from "./enums";
import { schoolsTable } from "./schools";

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
    // Teachers verify in two stages; donor records leave this null.
    stage: verificationStageEnum("stage"),
    // The school an administrator confirmed the teacher works at (professional stage).
    schoolId: uuid("school_id").references(() => schoolsTable.id, {
      onDelete: "set null",
    }),
    status: verificationStatusEnum("status").notNull().default("PENDING"),
    applicantNote: text("applicant_note"),
    documentObjectKey: text("document_object_key"),
    privateReviewNotes: text("private_review_notes"),
    // Shown to the applicant: why it was rejected or what else is needed.
    reviewerFeedback: text("reviewer_feedback"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
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
    index("verification_records_user_stage_idx").on(
      table.userId,
      table.stage,
      table.createdAt,
    ),
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

// Private evidence files. The bytes live in private object storage; only
// metadata is kept here, and files are only ever opened through short-lived
// signed URLs issued (and audit-logged) by the API.
export const verificationDocumentsTable = pgTable(
  "verification_documents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    // Null while the file is an unsubmitted draft attachment.
    recordId: uuid("record_id").references(() => verificationRecordsTable.id, {
      onDelete: "set null",
    }),
    stage: verificationStageEnum("stage").notNull(),
    documentType: verificationDocumentTypeEnum("document_type").notNull(),
    originalFilename: text("original_filename").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256").notNull(),
    objectKey: text("object_key").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("verification_documents_user_stage_idx").on(
      table.userId,
      table.stage,
      table.createdAt,
    ),
    index("verification_documents_record_idx").on(table.recordId),
  ],
);

export type VerificationDocument = typeof verificationDocumentsTable.$inferSelect;
