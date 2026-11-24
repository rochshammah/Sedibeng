CREATE TYPE "public"."order_event_type" AS ENUM('OFFER_ACCEPTED', 'PREPARATION_STARTED', 'GOODS_READY', 'HANDOFF_CONFIRMED', 'GOODS_RECEIVED', 'ISSUE_REPORTED', 'ISSUE_RESOLVED', 'GOODS_DISTRIBUTED', 'OFFER_CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."order_issue_type" AS ENUM('MISSING', 'DAMAGED', 'INCORRECT');--> statement-breakpoint
ALTER TYPE "public"."order_status" ADD VALUE 'PARTIALLY_HANDED_OVER' BEFORE 'FULFILLED';--> statement-breakpoint
ALTER TYPE "public"."order_status" ADD VALUE 'HANDED_OVER' BEFORE 'FULFILLED';--> statement-breakpoint
ALTER TYPE "public"."order_status" ADD VALUE 'PARTIALLY_RECEIVED' BEFORE 'FULFILLED';--> statement-breakpoint
ALTER TYPE "public"."order_status" ADD VALUE 'RECEIVED' BEFORE 'FULFILLED';--> statement-breakpoint
ALTER TYPE "public"."order_status" ADD VALUE 'RESOLUTION_REQUIRED' BEFORE 'FULFILLED';--> statement-breakpoint
CREATE TABLE "order_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"action_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"actor_role" "user_role" NOT NULL,
	"event_type" "order_event_type" NOT NULL,
	"status_after" "order_status" NOT NULL,
	"quantity" integer,
	"issue_type" "order_issue_type",
	"note" text,
	"private_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sponsorships" ADD COLUMN "accepted_quantity" integer;--> statement-breakpoint
ALTER TABLE "sponsorships" ADD COLUMN "client_action_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "handed_over_quantity" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "received_quantity" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "distributed_quantity" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "target_path" text;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "dedupe_key" text;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "order_events_order_action_uidx" ON "order_events" USING btree ("order_id","action_id");--> statement-breakpoint
CREATE INDEX "order_events_order_created_idx" ON "order_events" USING btree ("order_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sponsorships_donor_action_uidx" ON "sponsorships" USING btree ("donor_user_id","client_action_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_dedupe_key_uidx" ON "notifications" USING btree ("dedupe_key");--> statement-breakpoint
ALTER TABLE "sponsorships" ADD CONSTRAINT "sponsorships_accepted_quantity_nonnegative" CHECK ("sponsorships"."accepted_quantity" is null or "sponsorships"."accepted_quantity" >= 0);--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_handed_over_nonnegative" CHECK ("orders"."handed_over_quantity" >= 0);--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_received_nonnegative" CHECK ("orders"."received_quantity" >= 0);--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_distributed_nonnegative" CHECK ("orders"."distributed_quantity" >= 0);
--> statement-breakpoint
UPDATE "sponsorships"
SET "accepted_quantity" = "quantity"
WHERE "status" IN ('APPROVED', 'FULFILLED');
--> statement-breakpoint
UPDATE "orders" AS o
SET
  "handed_over_quantity" = s."quantity",
  "received_quantity" = s."quantity"
FROM "sponsorships" AS s
WHERE o."sponsorship_id" = s."id"
  AND o."status" = 'FULFILLED';