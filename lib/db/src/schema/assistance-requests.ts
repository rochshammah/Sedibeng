import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
  integer,
  boolean,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import {
  assistanceRequestStatusEnum,
  requestPriorityEnum,
} from "./enums";
import { schoolsTable } from "./schools";
import { usersTable } from "./users";

export const assistanceRequestsTable = pgTable(
  "assistance_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    teacherUserId: uuid("teacher_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "restrict" }),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schoolsTable.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    category: text("category").notNull(),
    item: text("item").notNull(),
    description: text("description").notNull(),
    specifications: text("specifications"),
    quantity: integer("quantity").notNull(),
    unit: text("unit").notNull(),
    district: text("district").notNull(),
    area: text("area"),
    schoolContext: text("school_context").notNull(),
    priority: requestPriorityEnum("priority").notNull().default("STANDARD"),
    status: assistanceRequestStatusEnum("status")
      .notNull()
      .default("PENDING_MODERATION"),
    privateModerationNotes: text("private_moderation_notes"),
    isSeedData: boolean("is_seed_data").notNull().default(false),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    check("assistance_requests_quantity_positive", sql` ${table.quantity} > 0`),
    index("assistance_requests_public_idx").on(
      table.status,
      table.district,
      table.priority,
      table.createdAt,
    ),
    index("assistance_requests_teacher_idx").on(
      table.teacherUserId,
      table.createdAt,
    ),
    index("assistance_requests_school_idx").on(table.schoolId),
    index("assistance_requests_category_idx").on(table.category, table.status),
  ],
);

export const insertAssistanceRequestSchema = createInsertSchema(
  assistanceRequestsTable,
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  publishedAt: true,
  privateModerationNotes: true,
  status: true,
  isSeedData: true,
});

export type InsertAssistanceRequest = z.infer<
  typeof insertAssistanceRequestSchema
>;
export type AssistanceRequestRow = typeof assistanceRequestsTable.$inferSelect;
