import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { sponsorshipStatusEnum } from "./enums";
import { assistanceRequestsTable } from "./assistance-requests";
import { donorInventoryTable } from "./donor-inventory";
import { usersTable } from "./users";

export const sponsorshipsTable = pgTable(
  "sponsorships",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => assistanceRequestsTable.id, { onDelete: "restrict" }),
    donorUserId: uuid("donor_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "restrict" }),
    inventoryId: uuid("inventory_id").references(() => donorInventoryTable.id, {
      onDelete: "set null",
    }),
    quantity: integer("quantity").notNull(),
    donorMessage: text("donor_message"),
    status: sponsorshipStatusEnum("status")
      .notNull()
      .default("PENDING_TEACHER_REVIEW"),
    reviewedBy: uuid("reviewed_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
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
    check("sponsorships_quantity_positive", sql`${table.quantity} > 0`),
    index("sponsorships_request_status_idx").on(table.requestId, table.status),
    index("sponsorships_donor_status_idx").on(
      table.donorUserId,
      table.status,
    ),
  ],
);

export const insertSponsorshipSchema = createInsertSchema(
  sponsorshipsTable,
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  status: true,
  reviewedBy: true,
  reviewedAt: true,
});

export type InsertSponsorship = z.infer<typeof insertSponsorshipSchema>;
export type Sponsorship = typeof sponsorshipsTable.$inferSelect;
