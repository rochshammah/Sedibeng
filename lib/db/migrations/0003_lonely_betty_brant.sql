-- Phase 3: two-stage teacher verification, private verification documents,
-- school directory fields and richer assistance requests.
-- Existing data is preserved. Legacy teacher verification records (created before
-- stages existed) keep stage = NULL and no longer satisfy the publishing rule:
-- teachers must complete both stages.
CREATE TYPE "public"."school_type" AS ENUM('PRIMARY', 'JUNIOR_SECONDARY', 'SENIOR_SECONDARY', 'SPECIAL_NEEDS', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."verification_document_type" AS ENUM('NATIONAL_ID', 'PASSPORT', 'DRIVING_LICENCE', 'TEACHING_LICENCE', 'EMPLOYMENT_LETTER', 'SCHOOL_CONFIRMATION', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."verification_stage" AS ENUM('IDENTITY', 'PROFESSIONAL');--> statement-breakpoint
ALTER TYPE "public"."assistance_request_status" ADD VALUE 'NEEDS_MORE_INFORMATION';--> statement-breakpoint
CREATE TABLE "verification_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"record_id" uuid,
	"stage" "verification_stage" NOT NULL,
	"document_type" "verification_document_type" NOT NULL,
	"original_filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"object_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "verification_documents_object_key_unique" UNIQUE("object_key")
);
--> statement-breakpoint
-- Keep existing rows: "APPROVED" becomes "VERIFIED" in place (no drop/recreate of the type).
ALTER TYPE "public"."verification_status" RENAME VALUE 'APPROVED' TO 'VERIFIED';--> statement-breakpoint
ALTER TYPE "public"."verification_status" ADD VALUE 'NEEDS_MORE_INFORMATION';--> statement-breakpoint
ALTER TYPE "public"."verification_status" ADD VALUE 'EXPIRED';--> statement-breakpoint
ALTER TABLE "schools" ADD COLUMN "school_type" "school_type";--> statement-breakpoint
ALTER TABLE "schools" ADD COLUMN "general_location" text;--> statement-breakpoint
ALTER TABLE "verification_records" ADD COLUMN "stage" "verification_stage";--> statement-breakpoint
ALTER TABLE "verification_records" ADD COLUMN "school_id" uuid;--> statement-breakpoint
ALTER TABLE "verification_records" ADD COLUMN "reviewer_feedback" text;--> statement-breakpoint
ALTER TABLE "verification_records" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "assistance_requests" ADD COLUMN "size" text;--> statement-breakpoint
ALTER TABLE "assistance_requests" ADD COLUMN "condition_requirement" text;--> statement-breakpoint
ALTER TABLE "assistance_requests" ADD COLUMN "required_by" date;--> statement-breakpoint
ALTER TABLE "assistance_requests" ADD COLUMN "teacher_private_notes" text;--> statement-breakpoint
ALTER TABLE "assistance_requests" ADD COLUMN "moderation_feedback" text;--> statement-breakpoint
ALTER TABLE "verification_documents" ADD CONSTRAINT "verification_documents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_documents" ADD CONSTRAINT "verification_documents_record_id_verification_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."verification_records"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "verification_documents_user_stage_idx" ON "verification_documents" USING btree ("user_id","stage","created_at");--> statement-breakpoint
CREATE INDEX "verification_documents_record_idx" ON "verification_documents" USING btree ("record_id");--> statement-breakpoint
ALTER TABLE "verification_records" ADD CONSTRAINT "verification_records_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "verification_records_user_stage_idx" ON "verification_records" USING btree ("user_id","stage","created_at");