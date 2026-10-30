import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { schoolsTable } from "./schools";
import { usersTable } from "./users";

export const teacherProfilesTable = pgTable(
  "teacher_profiles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schoolsTable.id, { onDelete: "restrict" }),
    position: text("position"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("teacher_profiles_user_uidx").on(table.userId),
    index("teacher_profiles_school_idx").on(table.schoolId),
  ],
);

export const insertTeacherProfileSchema = createInsertSchema(
  teacherProfilesTable,
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertTeacherProfile = z.infer<typeof insertTeacherProfileSchema>;
export type TeacherProfile = typeof teacherProfilesTable.$inferSelect;
