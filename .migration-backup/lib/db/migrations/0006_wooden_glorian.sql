ALTER TABLE "orders" ADD CONSTRAINT "orders_received_lte_handed_over" CHECK ("orders"."received_quantity" <= "orders"."handed_over_quantity");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_distributed_lte_received" CHECK ("orders"."distributed_quantity" <= "orders"."received_quantity");--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_quantity_positive" CHECK ("order_events"."quantity" is null or "order_events"."quantity" > 0);
--> statement-breakpoint
UPDATE "orders"
SET "status" = 'RECEIVED'
WHERE "status" = 'FULFILLED';
--> statement-breakpoint
INSERT INTO "order_events" (
  "order_id",
  "action_id",
  "actor_user_id",
  "actor_role",
  "event_type",
  "status_after",
  "quantity",
  "created_at"
)
SELECT
  o."id",
  gen_random_uuid(),
  s."reviewed_by",
  'TEACHER'::"user_role",
  'OFFER_ACCEPTED'::"order_event_type",
  'PREPARING'::"order_status",
  coalesce(s."accepted_quantity", s."quantity"),
  o."created_at"
FROM "orders" AS o
INNER JOIN "sponsorships" AS s ON s."id" = o."sponsorship_id";
--> statement-breakpoint
INSERT INTO "order_events" (
  "order_id",
  "action_id",
  "actor_user_id",
  "actor_role",
  "event_type",
  "status_after",
  "created_at"
)
SELECT
  o."id",
  gen_random_uuid(),
  s."donor_user_id",
  'DONOR'::"user_role",
  'GOODS_READY'::"order_event_type",
  'READY_FOR_HANDOFF'::"order_status",
  o."updated_at"
FROM "orders" AS o
INNER JOIN "sponsorships" AS s ON s."id" = o."sponsorship_id"
WHERE o."status" = 'READY_FOR_HANDOFF';
--> statement-breakpoint
INSERT INTO "order_events" (
  "order_id",
  "action_id",
  "actor_user_id",
  "actor_role",
  "event_type",
  "status_after",
  "quantity",
  "created_at"
)
SELECT
  o."id",
  gen_random_uuid(),
  r."teacher_user_id",
  'TEACHER'::"user_role",
  'GOODS_RECEIVED'::"order_event_type",
  'RECEIVED'::"order_status",
  coalesce(s."accepted_quantity", s."quantity"),
  o."updated_at"
FROM "orders" AS o
INNER JOIN "sponsorships" AS s ON s."id" = o."sponsorship_id"
INNER JOIN "assistance_requests" AS r ON r."id" = s."request_id"
WHERE o."status" = 'RECEIVED';
--> statement-breakpoint
INSERT INTO "order_events" (
  "order_id",
  "action_id",
  "actor_user_id",
  "actor_role",
  "event_type",
  "status_after",
  "note",
  "created_at"
)
SELECT
  o."id",
  gen_random_uuid(),
  cancellation."actor_user_id",
  coalesce(cancellation."actor_role", 'TEACHER'::"user_role"),
  'OFFER_CANCELLED'::"order_event_type",
  'CANCELLED'::"order_status",
  'Cancelled before detailed handoff tracking was introduced.',
  coalesce(cancellation."created_at", o."updated_at")
FROM "orders" AS o
LEFT JOIN LATERAL (
  SELECT
    a."actor_user_id",
    u."role" AS "actor_role",
    a."created_at"
  FROM "audit_logs" AS a
  LEFT JOIN "users" AS u ON u."id" = a."actor_user_id"
  WHERE a."target_type" = 'ORDER'
    AND a."target_id" = o."id"
    AND a."metadata" ->> 'status' = 'CANCELLED'
  ORDER BY a."created_at" DESC
  LIMIT 1
) AS cancellation ON true
WHERE o."status" = 'CANCELLED';