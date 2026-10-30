import { pgEnum } from "drizzle-orm/pg-core";

export const userRoleEnum = pgEnum("user_role", [
  "DONOR",
  "TEACHER",
  "ADMIN",
  "SCHOOL_REPRESENTATIVE",
]);

export const userStatusEnum = pgEnum("user_status", [
  "PENDING_VERIFICATION",
  "ACTIVE",
  "SUSPENDED",
]);

export const schoolStatusEnum = pgEnum("school_status", [
  "PENDING_REVIEW",
  "ACTIVE",
  "SUSPENDED",
]);

export const verificationStatusEnum = pgEnum("verification_status", [
  "PENDING",
  "APPROVED",
  "REJECTED",
]);

export const assistanceRequestStatusEnum = pgEnum("assistance_request_status", [
  "DRAFT",
  "PENDING_MODERATION",
  "OPEN",
  "PARTIALLY_MATCHED",
  "MATCHED",
  "FULFILLED",
  "REJECTED",
  "CANCELLED",
]);

export const requestPriorityEnum = pgEnum("request_priority", [
  "STANDARD",
  "HIGH",
  "ESSENTIAL",
]);

export const inventoryStatusEnum = pgEnum("inventory_status", [
  "DRAFT",
  "AVAILABLE",
  "RESERVED",
  "WITHDRAWN",
]);

export const sponsorshipStatusEnum = pgEnum("sponsorship_status", [
  "PENDING_TEACHER_REVIEW",
  "APPROVED",
  "REJECTED",
  "CANCELLED",
  "FULFILLED",
]);

export const orderStatusEnum = pgEnum("order_status", [
  "AWAITING_TEACHER_APPROVAL",
  "PREPARING",
  "READY_FOR_HANDOFF",
  "FULFILLED",
  "CANCELLED",
]);

export const deliveryStatusEnum = pgEnum("delivery_status", [
  "PLANNED",
  "READY",
  "COMPLETED",
  "CANCELLED",
]);

export const reportStatusEnum = pgEnum("report_status", [
  "OPEN",
  "UNDER_REVIEW",
  "RESOLVED",
  "DISMISSED",
]);

export const reportTargetTypeEnum = pgEnum("report_target_type", [
  "REQUEST",
  "INVENTORY",
  "SPONSORSHIP",
  "USER",
]);

export const verificationTypeEnum = pgEnum("verification_type", [
  "TEACHER",
  "DONOR",
]);
