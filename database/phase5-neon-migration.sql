-- Sedibeng: reconcile the Neon database with migrations 0002–0006.
--
-- Read-only comparison on 2026-11-20 found that the public schema matches the
-- project's migration 0004 snapshot, while drizzle.__drizzle_migrations only
-- records migrations 0000 and 0001. This script records 0002–0004 as already
-- present, applies the Phase 5 migrations 0005 and 0006, and records them.
--
-- Run once in the Neon SQL Editor against the Sedibeng database. Review the
-- target database before running. The enum section is committed separately
-- because PostgreSQL requires new enum values to be committed before use.
-- The data backfill and migration marker for 0006 share a transaction.

-- ---------------------------------------------------------------------------
-- Preflight: reject a different database or conflicting migration history.
-- ---------------------------------------------------------------------------
BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('drizzle.__drizzle_migrations') IS NULL THEN
    RAISE EXCEPTION 'Expected Drizzle migration history table drizzle.__drizzle_migrations was not found.';
  END IF;

  IF to_regclass('public.users') IS NULL
    OR to_regclass('public.schools') IS NULL
    OR to_regclass('public.assistance_requests') IS NULL
    OR to_regclass('public.donor_inventory') IS NULL
    OR to_regclass('public.sponsorships') IS NULL
    OR to_regclass('public.orders') IS NULL
    OR to_regclass('public.notifications') IS NULL
    OR to_regclass('public.audit_logs') IS NULL
    OR to_regclass('public.saved_requests') IS NULL
    OR to_regclass('public.verification_documents') IS NULL
    OR to_regclass('public.service_areas') IS NULL
    OR to_regclass('public.locations') IS NULL THEN
    RAISE EXCEPTION 'The Neon database does not have the expected Sedibeng schema through migration 0004. No migration was applied.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'sponsorships'
      AND column_name = 'inventory_id'
      AND is_nullable = 'YES'
  ) THEN
    RAISE EXCEPTION 'sponsorships.inventory_id is not nullable. The source-goods offer flow requires it to allow NULL.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
      AND t.typname = 'order_status'
      AND e.enumlabel = 'FULFILLED'
  ) THEN
    RAISE EXCEPTION 'The expected pre-Phase-5 order_status enum was not found. No migration was applied.';
  END IF;

  -- Confirm the two existing migration records exactly match the checked-in
  -- migration files, and reject conflicting or unknown newer history.
  IF NOT EXISTS (
    SELECT 1 FROM drizzle.__drizzle_migrations
    WHERE created_at = 1793370257497
      AND hash = '5254f4dd739e7eec35af5428ff6628ab84bd15b05668e0e11f813f84b7902544'
  ) OR NOT EXISTS (
    SELECT 1 FROM drizzle.__drizzle_migrations
    WHERE created_at = 1793592483086
      AND hash = 'a747b4f6542aa56512a60de13f923c20845b3b867a8fb412f94836860b1d1cd3'
  ) THEN
    RAISE EXCEPTION 'The existing 0000/0001 Drizzle history differs from the project migration files. No migration was applied.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM drizzle.__drizzle_migrations m
    WHERE
      (m.created_at = 1793370257497 AND m.hash <> '5254f4dd739e7eec35af5428ff6628ab84bd15b05668e0e11f813f84b7902544')
      OR (m.created_at = 1793592483086 AND m.hash <> 'a747b4f6542aa56512a60de13f923c20845b3b867a8fb412f94836860b1d1cd3')
      OR (m.created_at = 1793876004555 AND m.hash <> 'ded0c22f553080732a0332311b498741000457094b14577e83833c6c82871f60')
      OR (m.created_at = 1794150706716 AND m.hash <> '4bb23ffc363f4f2d99725c38194b481d6517f670607574e38018af2ba80641c3')
      OR (m.created_at = 1794657566276 AND m.hash <> '16e874dc4d784b8429c2d4c67bfa8bd307c682ec87af36a1bcd75e7b5feb56a9')
      OR (m.created_at = 1795020304509 AND m.hash <> 'c6f5c79fc1d53a3eba85f297f21fdf7d9e3f6685c2602523c2b6638fdf661b78')
      OR (m.created_at = 1795020621739 AND m.hash <> '80a0f331936201035db3ca674973875a371b1fe0c97a2ed654dd09bf1b1177a8')
      OR (m.hash = 'ded0c22f553080732a0332311b498741000457094b14577e83833c6c82871f60' AND m.created_at <> 1793876004555)
      OR (m.hash = '4bb23ffc363f4f2d99725c38194b481d6517f670607574e38018af2ba80641c3' AND m.created_at <> 1794150706716)
      OR (m.hash = '16e874dc4d784b8429c2d4c67bfa8bd307c682ec87af36a1bcd75e7b5feb56a9' AND m.created_at <> 1794657566276)
      OR (m.hash = 'c6f5c79fc1d53a3eba85f297f21fdf7d9e3f6685c2602523c2b6638fdf661b78' AND m.created_at <> 1795020304509)
      OR (m.hash = '80a0f331936201035db3ca674973875a371b1fe0c97a2ed654dd09bf1b1177a8' AND m.created_at <> 1795020621739)
      OR (
        m.created_at > 1793592483086
        AND NOT (
          (m.created_at = 1793876004555 AND m.hash = 'ded0c22f553080732a0332311b498741000457094b14577e83833c6c82871f60')
          OR (m.created_at = 1794150706716 AND m.hash = '4bb23ffc363f4f2d99725c38194b481d6517f670607574e38018af2ba80641c3')
          OR (m.created_at = 1794657566276 AND m.hash = '16e874dc4d784b8429c2d4c67bfa8bd307c682ec87af36a1bcd75e7b5feb56a9')
          OR (m.created_at = 1795020304509 AND m.hash = 'c6f5c79fc1d53a3eba85f297f21fdf7d9e3f6685c2602523c2b6638fdf661b78')
          OR (m.created_at = 1795020621739 AND m.hash = '80a0f331936201035db3ca674973875a371b1fe0c97a2ed654dd09bf1b1177a8')
        )
      )
  ) THEN
    RAISE EXCEPTION 'The Drizzle migration history contains a conflicting or newer migration. No migration was applied.';
  END IF;
END
$preflight$;

COMMIT;

-- ---------------------------------------------------------------------------
-- Migration 0005: add handoff enum values and event-history types.
-- Commit these enum changes before using the new values in the data backfill.
-- ---------------------------------------------------------------------------
BEGIN;

DO $types$
BEGIN
  IF to_regtype('public.order_event_type') IS NULL THEN
    CREATE TYPE public.order_event_type AS ENUM (
      'OFFER_ACCEPTED',
      'PREPARATION_STARTED',
      'GOODS_READY',
      'HANDOFF_CONFIRMED',
      'GOODS_RECEIVED',
      'ISSUE_REPORTED',
      'ISSUE_RESOLVED',
      'GOODS_DISTRIBUTED',
      'OFFER_CANCELLED'
    );
  END IF;

  IF to_regtype('public.order_issue_type') IS NULL THEN
    CREATE TYPE public.order_issue_type AS ENUM (
      'MISSING',
      'DAMAGED',
      'INCORRECT'
    );
  END IF;
END
$types$;

ALTER TYPE public.order_status
  ADD VALUE IF NOT EXISTS 'PARTIALLY_HANDED_OVER' BEFORE 'FULFILLED';
ALTER TYPE public.order_status
  ADD VALUE IF NOT EXISTS 'HANDED_OVER' BEFORE 'FULFILLED';
ALTER TYPE public.order_status
  ADD VALUE IF NOT EXISTS 'PARTIALLY_RECEIVED' BEFORE 'FULFILLED';
ALTER TYPE public.order_status
  ADD VALUE IF NOT EXISTS 'RECEIVED' BEFORE 'FULFILLED';
ALTER TYPE public.order_status
  ADD VALUE IF NOT EXISTS 'RESOLUTION_REQUIRED' BEFORE 'FULFILLED';

-- Keep this transaction limited to enum/type changes so those values are
-- committed before migration 0006 writes rows that use them.
COMMIT;

-- ---------------------------------------------------------------------------
-- Migration 0005: Phase 5 fields, event history, and integrity constraints.
-- ---------------------------------------------------------------------------
BEGIN;

CREATE TABLE IF NOT EXISTS public.order_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  order_id uuid NOT NULL,
  action_id uuid NOT NULL,
  actor_user_id uuid,
  actor_role public.user_role NOT NULL,
  event_type public.order_event_type NOT NULL,
  status_after public.order_status NOT NULL,
  quantity integer,
  issue_type public.order_issue_type,
  note text,
  private_note text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.sponsorships
  ADD COLUMN IF NOT EXISTS accepted_quantity integer;
ALTER TABLE public.sponsorships
  ADD COLUMN IF NOT EXISTS client_action_id uuid;
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS handed_over_quantity integer DEFAULT 0 NOT NULL;
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS received_quantity integer DEFAULT 0 NOT NULL;
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS distributed_quantity integer DEFAULT 0 NOT NULL;
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS target_path text;
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS dedupe_key text;

DO $constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.order_events'::regclass
      AND conname = 'order_events_order_id_orders_id_fk'
  ) THEN
    ALTER TABLE public.order_events
      ADD CONSTRAINT order_events_order_id_orders_id_fk
      FOREIGN KEY (order_id) REFERENCES public.orders(id)
      ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.order_events'::regclass
      AND conname = 'order_events_actor_user_id_users_id_fk'
  ) THEN
    ALTER TABLE public.order_events
      ADD CONSTRAINT order_events_actor_user_id_users_id_fk
      FOREIGN KEY (actor_user_id) REFERENCES public.users(id)
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.sponsorships'::regclass
      AND conname = 'sponsorships_accepted_quantity_nonnegative'
  ) THEN
    ALTER TABLE public.sponsorships
      ADD CONSTRAINT sponsorships_accepted_quantity_nonnegative
      CHECK (accepted_quantity IS NULL OR accepted_quantity >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.orders'::regclass
      AND conname = 'orders_handed_over_nonnegative'
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_handed_over_nonnegative
      CHECK (handed_over_quantity >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.orders'::regclass
      AND conname = 'orders_received_nonnegative'
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_received_nonnegative
      CHECK (received_quantity >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.orders'::regclass
      AND conname = 'orders_distributed_nonnegative'
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_distributed_nonnegative
      CHECK (distributed_quantity >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.orders'::regclass
      AND conname = 'orders_received_lte_handed_over'
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_received_lte_handed_over
      CHECK (received_quantity <= handed_over_quantity);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.orders'::regclass
      AND conname = 'orders_distributed_lte_received'
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_distributed_lte_received
      CHECK (distributed_quantity <= received_quantity);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.order_events'::regclass
      AND conname = 'order_events_quantity_positive'
  ) THEN
    ALTER TABLE public.order_events
      ADD CONSTRAINT order_events_quantity_positive
      CHECK (quantity IS NULL OR quantity > 0);
  END IF;
END
$constraints$;

CREATE UNIQUE INDEX IF NOT EXISTS order_events_order_action_uidx
  ON public.order_events USING btree (order_id, action_id);
CREATE INDEX IF NOT EXISTS order_events_order_created_idx
  ON public.order_events USING btree (order_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS sponsorships_donor_action_uidx
  ON public.sponsorships USING btree (donor_user_id, client_action_id);
CREATE UNIQUE INDEX IF NOT EXISTS notifications_dedupe_key_uidx
  ON public.notifications USING btree (dedupe_key);

-- Migrations 0002–0004 already match the checked-in 0004 schema snapshot.
-- Record those existing changes, then record 0005 only after its DDL succeeds.
INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
SELECT m.hash, m.created_at
FROM (VALUES
  ('ded0c22f553080732a0332311b498741000457094b14577e83833c6c82871f60', 1793876004555::bigint),
  ('4bb23ffc363f4f2d99725c38194b481d6517f670607574e38018af2ba80641c3', 1794150706716::bigint),
  ('16e874dc4d784b8429c2d4c67bfa8bd307c682ec87af36a1bcd75e7b5feb56a9', 1794657566276::bigint),
  ('c6f5c79fc1d53a3eba85f297f21fdf7d9e3f6685c2602523c2b6638fdf661b78', 1795020304509::bigint)
) AS m(hash, created_at)
WHERE NOT EXISTS (
  SELECT 1
  FROM drizzle.__drizzle_migrations existing
  WHERE existing.hash = m.hash AND existing.created_at = m.created_at
);

COMMIT;

-- ---------------------------------------------------------------------------
-- Migration 0006: backfill accepted quantities, legacy handoffs, and history.
-- The marker and data updates commit together, so a successful rerun is safe.
-- ---------------------------------------------------------------------------
BEGIN;

DO $backfill$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM drizzle.__drizzle_migrations
    WHERE hash = '80a0f331936201035db3ca674973875a371b1fe0c97a2ed654dd09bf1b1177a8'
      AND created_at = 1795020621739
  ) THEN
    UPDATE public.sponsorships
    SET accepted_quantity = quantity
    WHERE status IN ('APPROVED', 'FULFILLED');

    UPDATE public.orders AS o
    SET
      handed_over_quantity = s.quantity,
      received_quantity = s.quantity
    FROM public.sponsorships AS s
    WHERE o.sponsorship_id = s.id
      AND o.status = 'FULFILLED';

    UPDATE public.orders
    SET status = 'RECEIVED'
    WHERE status = 'FULFILLED';

    INSERT INTO public.order_events (
      order_id, action_id, actor_user_id, actor_role, event_type,
      status_after, quantity, created_at
    )
    SELECT
      o.id, gen_random_uuid(), s.reviewed_by, 'TEACHER'::public.user_role,
      'OFFER_ACCEPTED'::public.order_event_type, 'PREPARING'::public.order_status,
      coalesce(s.accepted_quantity, s.quantity), o.created_at
    FROM public.orders AS o
    INNER JOIN public.sponsorships AS s ON s.id = o.sponsorship_id
    WHERE NOT EXISTS (
      SELECT 1 FROM public.order_events e
      WHERE e.order_id = o.id AND e.event_type = 'OFFER_ACCEPTED'
    );

    INSERT INTO public.order_events (
      order_id, action_id, actor_user_id, actor_role, event_type,
      status_after, created_at
    )
    SELECT
      o.id, gen_random_uuid(), s.donor_user_id, 'DONOR'::public.user_role,
      'GOODS_READY'::public.order_event_type,
      'READY_FOR_HANDOFF'::public.order_status, o.updated_at
    FROM public.orders AS o
    INNER JOIN public.sponsorships AS s ON s.id = o.sponsorship_id
    WHERE o.status = 'READY_FOR_HANDOFF'
      AND NOT EXISTS (
        SELECT 1 FROM public.order_events e
        WHERE e.order_id = o.id AND e.event_type = 'GOODS_READY'
      );

    INSERT INTO public.order_events (
      order_id, action_id, actor_user_id, actor_role, event_type,
      status_after, quantity, created_at
    )
    SELECT
      o.id, gen_random_uuid(), r.teacher_user_id, 'TEACHER'::public.user_role,
      'GOODS_RECEIVED'::public.order_event_type, 'RECEIVED'::public.order_status,
      coalesce(s.accepted_quantity, s.quantity), o.updated_at
    FROM public.orders AS o
    INNER JOIN public.sponsorships AS s ON s.id = o.sponsorship_id
    INNER JOIN public.assistance_requests AS r ON r.id = s.request_id
    WHERE o.status = 'RECEIVED'
      AND NOT EXISTS (
        SELECT 1 FROM public.order_events e
        WHERE e.order_id = o.id AND e.event_type = 'GOODS_RECEIVED'
      );

    INSERT INTO public.order_events (
      order_id, action_id, actor_user_id, actor_role, event_type,
      status_after, note, created_at
    )
    SELECT
      o.id, gen_random_uuid(), cancellation.actor_user_id,
      coalesce(cancellation.actor_role, 'TEACHER'::public.user_role),
      'OFFER_CANCELLED'::public.order_event_type,
      'CANCELLED'::public.order_status,
      'Cancelled before detailed handoff tracking was introduced.',
      coalesce(cancellation.created_at, o.updated_at)
    FROM public.orders AS o
    LEFT JOIN LATERAL (
      SELECT a.actor_user_id, u.role AS actor_role, a.created_at
      FROM public.audit_logs AS a
      LEFT JOIN public.users AS u ON u.id = a.actor_user_id
      WHERE a.target_type = 'ORDER'
        AND a.target_id = o.id
        AND a.metadata ->> 'status' = 'CANCELLED'
      ORDER BY a.created_at DESC
      LIMIT 1
    ) AS cancellation ON true
    WHERE o.status = 'CANCELLED'
      AND NOT EXISTS (
        SELECT 1 FROM public.order_events e
        WHERE e.order_id = o.id AND e.event_type = 'OFFER_CANCELLED'
      );
  END IF;
END
$backfill$;

INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
SELECT
  '80a0f331936201035db3ca674973875a371b1fe0c97a2ed654dd09bf1b1177a8',
  1795020621739
WHERE NOT EXISTS (
  SELECT 1 FROM drizzle.__drizzle_migrations
  WHERE hash = '80a0f331936201035db3ca674973875a371b1fe0c97a2ed654dd09bf1b1177a8'
    AND created_at = 1795020621739
);

COMMIT;

-- ---------------------------------------------------------------------------
-- Read-only verification results.
-- ---------------------------------------------------------------------------
SELECT id, created_at
FROM drizzle.__drizzle_migrations
WHERE created_at IN (
  1793876004555, 1794150706716, 1794657566276,
  1795020304509, 1795020621739
)
ORDER BY created_at;

SELECT event_type, count(*) AS event_count
FROM public.order_events
GROUP BY event_type
ORDER BY event_type;

SELECT status, count(*) AS order_count
FROM public.orders
GROUP BY status
ORDER BY status;
