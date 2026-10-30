CREATE TYPE "public"."assistance_request_status" AS ENUM('DRAFT', 'PENDING_MODERATION', 'OPEN', 'PARTIALLY_MATCHED', 'MATCHED', 'FULFILLED', 'REJECTED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."delivery_status" AS ENUM('PLANNED', 'READY', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."inventory_status" AS ENUM('DRAFT', 'AVAILABLE', 'RESERVED', 'WITHDRAWN');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('AWAITING_TEACHER_APPROVAL', 'PREPARING', 'READY_FOR_HANDOFF', 'FULFILLED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."report_status" AS ENUM('OPEN', 'UNDER_REVIEW', 'RESOLVED', 'DISMISSED');--> statement-breakpoint
CREATE TYPE "public"."report_target_type" AS ENUM('REQUEST', 'INVENTORY', 'SPONSORSHIP', 'USER');--> statement-breakpoint
CREATE TYPE "public"."request_priority" AS ENUM('STANDARD', 'HIGH', 'ESSENTIAL');--> statement-breakpoint
CREATE TYPE "public"."school_status" AS ENUM('PENDING_REVIEW', 'ACTIVE', 'SUSPENDED');--> statement-breakpoint
CREATE TYPE "public"."sponsorship_status" AS ENUM('PENDING_TEACHER_REVIEW', 'APPROVED', 'REJECTED', 'CANCELLED', 'FULFILLED');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('DONOR', 'TEACHER', 'ADMIN', 'SCHOOL_REPRESENTATIVE');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED');--> statement-breakpoint
CREATE TYPE "public"."verification_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."verification_type" AS ENUM('TEACHER', 'DONOR');--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "user_role" NOT NULL,
	"status" "user_status" DEFAULT 'PENDING_VERIFICATION' NOT NULL,
	"email_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schools" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"district" text DEFAULT 'Gaborone' NOT NULL,
	"area" text,
	"country_code" text DEFAULT 'BW' NOT NULL,
	"status" "school_status" DEFAULT 'PENDING_REVIEW' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teacher_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"position" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"reviewed_by" uuid,
	"type" "verification_type" NOT NULL,
	"status" "verification_status" DEFAULT 'PENDING' NOT NULL,
	"document_object_key" text,
	"private_review_notes" text,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assistance_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"teacher_user_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"title" text NOT NULL,
	"category" text NOT NULL,
	"item" text NOT NULL,
	"description" text NOT NULL,
	"specifications" text,
	"quantity" integer NOT NULL,
	"unit" text NOT NULL,
	"district" text NOT NULL,
	"area" text,
	"school_context" text NOT NULL,
	"priority" "request_priority" DEFAULT 'STANDARD' NOT NULL,
	"status" "assistance_request_status" DEFAULT 'PENDING_MODERATION' NOT NULL,
	"private_moderation_notes" text,
	"is_seed_data" boolean DEFAULT false NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assistance_requests_quantity_positive" CHECK ( "assistance_requests"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "donor_inventory" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"donor_user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"category" text NOT NULL,
	"item" text NOT NULL,
	"description" text NOT NULL,
	"specifications" text,
	"quantity_available" integer NOT NULL,
	"unit" text NOT NULL,
	"district" text NOT NULL,
	"area" text,
	"status" "inventory_status" DEFAULT 'DRAFT' NOT NULL,
	"is_seed_data" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "donor_inventory_quantity_positive" CHECK ("donor_inventory"."quantity_available" > 0)
);
--> statement-breakpoint
CREATE TABLE "sponsorships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"donor_user_id" uuid NOT NULL,
	"inventory_id" uuid,
	"quantity" integer NOT NULL,
	"donor_message" text,
	"status" "sponsorship_status" DEFAULT 'PENDING_TEACHER_REVIEW' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sponsorships_quantity_positive" CHECK ("sponsorships"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sponsorship_id" uuid NOT NULL,
	"status" "order_status" DEFAULT 'AWAITING_TEACHER_APPROVAL' NOT NULL,
	"expected_handoff_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_sponsorship_id_unique" UNIQUE("sponsorship_id")
);
--> statement-breakpoint
CREATE TABLE "deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"status" "delivery_status" DEFAULT 'PLANNED' NOT NULL,
	"general_area" text,
	"handoff_notes" text,
	"scheduled_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deliveries_order_id_unique" UNIQUE("order_id")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reporter_user_id" uuid NOT NULL,
	"target_type" "report_target_type" NOT NULL,
	"target_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"details" text,
	"status" "report_status" DEFAULT 'OPEN' NOT NULL,
	"reviewed_by" uuid,
	"admin_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_sessions" (
	"session_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "password_reset_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "email_verification_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_verification_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "teacher_profiles" ADD CONSTRAINT "teacher_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_profiles" ADD CONSTRAINT "teacher_profiles_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_records" ADD CONSTRAINT "verification_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_records" ADD CONSTRAINT "verification_records_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistance_requests" ADD CONSTRAINT "assistance_requests_teacher_user_id_users_id_fk" FOREIGN KEY ("teacher_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistance_requests" ADD CONSTRAINT "assistance_requests_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donor_inventory" ADD CONSTRAINT "donor_inventory_donor_user_id_users_id_fk" FOREIGN KEY ("donor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sponsorships" ADD CONSTRAINT "sponsorships_request_id_assistance_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."assistance_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sponsorships" ADD CONSTRAINT "sponsorships_donor_user_id_users_id_fk" FOREIGN KEY ("donor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sponsorships" ADD CONSTRAINT "sponsorships_inventory_id_donor_inventory_id_fk" FOREIGN KEY ("inventory_id") REFERENCES "public"."donor_inventory"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sponsorships" ADD CONSTRAINT "sponsorships_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_sponsorship_id_sponsorships_id_fk" FOREIGN KEY ("sponsorship_id") REFERENCES "public"."sponsorships"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_user_id_users_id_fk" FOREIGN KEY ("reporter_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "email_verification_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_uidx" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "users_role_status_idx" ON "users" USING btree ("role","status");--> statement-breakpoint
CREATE UNIQUE INDEX "schools_name_district_area_uidx" ON "schools" USING btree (lower("name"),lower("district"),lower(coalesce("area", '')));--> statement-breakpoint
CREATE INDEX "schools_district_area_idx" ON "schools" USING btree ("district","area");--> statement-breakpoint
CREATE INDEX "schools_status_idx" ON "schools" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "teacher_profiles_user_uidx" ON "teacher_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "teacher_profiles_school_idx" ON "teacher_profiles" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "verification_records_user_status_idx" ON "verification_records" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "verification_records_status_created_idx" ON "verification_records" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "assistance_requests_public_idx" ON "assistance_requests" USING btree ("status","district","priority","created_at");--> statement-breakpoint
CREATE INDEX "assistance_requests_teacher_idx" ON "assistance_requests" USING btree ("teacher_user_id","created_at");--> statement-breakpoint
CREATE INDEX "assistance_requests_school_idx" ON "assistance_requests" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "assistance_requests_category_idx" ON "assistance_requests" USING btree ("category","status");--> statement-breakpoint
CREATE INDEX "donor_inventory_donor_status_idx" ON "donor_inventory" USING btree ("donor_user_id","status");--> statement-breakpoint
CREATE INDEX "donor_inventory_public_idx" ON "donor_inventory" USING btree ("status","district","category");--> statement-breakpoint
CREATE INDEX "sponsorships_request_status_idx" ON "sponsorships" USING btree ("request_id","status");--> statement-breakpoint
CREATE INDEX "sponsorships_donor_status_idx" ON "sponsorships" USING btree ("donor_user_id","status");--> statement-breakpoint
CREATE INDEX "orders_status_created_idx" ON "orders" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "deliveries_status_scheduled_idx" ON "deliveries" USING btree ("status","scheduled_at");--> statement-breakpoint
CREATE INDEX "notifications_user_read_created_idx" ON "notifications" USING btree ("user_id","read_at","created_at");--> statement-breakpoint
CREATE INDEX "reports_status_created_idx" ON "reports" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "reports_target_idx" ON "reports" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "reports_reporter_idx" ON "reports" USING btree ("reporter_user_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_actor_created_idx" ON "audit_logs" USING btree ("actor_user_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_target_idx" ON "audit_logs" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "audit_logs_action_created_idx" ON "audit_logs" USING btree ("action","created_at");--> statement-breakpoint
CREATE INDEX "user_sessions_user_expires_idx" ON "user_sessions" USING btree ("user_id","expires_at");--> statement-breakpoint
CREATE INDEX "user_sessions_expires_idx" ON "user_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "password_reset_user_created_idx" ON "password_reset_tokens" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "password_reset_expires_idx" ON "password_reset_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "email_verification_user_created_idx" ON "email_verification_tokens" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "email_verification_expires_idx" ON "email_verification_tokens" USING btree ("expires_at");