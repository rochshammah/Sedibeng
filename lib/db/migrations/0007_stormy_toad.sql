CREATE TABLE "handoff_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"sender_user_id" uuid NOT NULL,
	"action_id" uuid NOT NULL,
	"body" varchar(1200) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "handoff_messages_body_nonempty" CHECK (length(btrim("handoff_messages"."body")) > 0)
);
--> statement-breakpoint
ALTER TABLE "handoff_messages" ADD CONSTRAINT "handoff_messages_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoff_messages" ADD CONSTRAINT "handoff_messages_sender_user_id_users_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "handoff_messages_order_created_idx" ON "handoff_messages" USING btree ("order_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "handoff_messages_sender_action_uidx" ON "handoff_messages" USING btree ("sender_user_id","action_id");