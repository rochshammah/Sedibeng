-- Sedibeng Phase 6: private donor-school handoff messages.
--
-- Read-only Neon inspection on 2026-11-24 confirmed that the live schema and
-- migration journal match migrations 0000-0006. The Phase 5 order, event,
-- sponsorship, and notification fields are already present. Migration 0007
-- is the only missing change: this script adds its handoff_messages table and
-- records the matching Drizzle migration. It does not re-run Phase 5.
--
-- Run against the Sedibeng Neon database. The script is transactional and
-- safe to re-run if migration 0007 has already been applied.

BEGIN;

DO $preflight$
DECLARE
  existing_column_count integer;
  recorded_phase5_count integer;
BEGIN
  IF to_regclass('public.orders') IS NULL
    OR to_regclass('public.users') IS NULL
    OR to_regclass('public.sponsorships') IS NULL
    OR to_regclass('public.order_events') IS NULL
    OR to_regclass('public.notifications') IS NULL THEN
    RAISE EXCEPTION 'Expected the Sedibeng schema through Phase 5. No changes were applied.';
  END IF;

  IF to_regclass('drizzle.__drizzle_migrations') IS NULL THEN
    RAISE EXCEPTION 'Expected drizzle.__drizzle_migrations. No changes were applied.';
  END IF;

  -- Confirm the current Phase 5 columns that the application still uses.
  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('sponsorships', 'accepted_quantity'),
      ('orders', 'handed_over_quantity'),
      ('orders', 'received_quantity'),
      ('orders', 'distributed_quantity'),
      ('order_events', 'event_type'),
      ('notifications', 'target_path'),
      ('notifications', 'dedupe_key')
    ) AS expected(table_name, column_name)
    WHERE NOT EXISTS (
      SELECT 1
      FROM information_schema.columns actual
      WHERE actual.table_schema = 'public'
        AND actual.table_name = expected.table_name
        AND actual.column_name = expected.column_name
    )
  ) THEN
    RAISE EXCEPTION 'The live Phase 5 schema is incomplete. No changes were applied.';
  END IF;

  IF to_regtype('public.order_event_type') IS NULL
    OR to_regtype('public.order_issue_type') IS NULL
    OR (
      SELECT count(*)
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'public'
        AND t.typname = 'order_status'
        AND e.enumlabel = ANY (ARRAY[
          'PARTIALLY_HANDED_OVER',
          'HANDED_OVER',
          'PARTIALLY_RECEIVED',
          'RECEIVED',
          'RESOLUTION_REQUIRED'
        ]::text[])
    ) <> 5 THEN
    RAISE EXCEPTION 'The live Phase 5 order types are incomplete. No changes were applied.';
  END IF;

  -- Require the exact checked-in 0000-0006 history before adding 0007.
  SELECT count(*)::integer
  INTO recorded_phase5_count
  FROM (VALUES
    ('5254f4dd739e7eec35af5428ff6628ab84bd15b05668e0e11f813f84b7902544', 1793370257497::bigint),
    ('a747b4f6542aa56512a60de13f923c20845b3b867a8fb412f94836860b1d1cd3', 1793592483086::bigint),
    ('ded0c22f553080732a0332311b498741000457094b14577e83833c6c82871f60', 1793876004555::bigint),
    ('4bb23ffc363f4f2d99725c38194b481d6517f670607574e38018af2ba80641c3', 1794150706716::bigint),
    ('16e874dc4d784b8429c2d4c67bfa8bd307c682ec87af36a1bcd75e7b5feb56a9', 1794657566276::bigint),
    ('c6f5c79fc1d53a3eba85f297f21fdf7d9e3f6685c2602523c2b6638fdf661b78', 1795020304509::bigint),
    ('80a0f331936201035db3ca674973875a371b1fe0c97a2ed654dd09bf1b1177a8', 1795020621739::bigint)
  ) AS expected(hash, created_at)
  INNER JOIN drizzle.__drizzle_migrations actual
    ON actual.hash = expected.hash
    AND actual.created_at = expected.created_at;

  IF recorded_phase5_count <> 7 THEN
    RAISE EXCEPTION 'The migration journal does not contain the expected 0000-0006 history. No changes were applied.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM drizzle.__drizzle_migrations actual
    WHERE NOT EXISTS (
      SELECT 1
      FROM (VALUES
        ('5254f4dd739e7eec35af5428ff6628ab84bd15b05668e0e11f813f84b7902544', 1793370257497::bigint),
        ('a747b4f6542aa56512a60de13f923c20845b3b867a8fb412f94836860b1d1cd3', 1793592483086::bigint),
        ('ded0c22f553080732a0332311b498741000457094b14577e83833c6c82871f60', 1793876004555::bigint),
        ('4bb23ffc363f4f2d99725c38194b481d6517f670607574e38018af2ba80641c3', 1794150706716::bigint),
        ('16e874dc4d784b8429c2d4c67bfa8bd307c682ec87af36a1bcd75e7b5feb56a9', 1794657566276::bigint),
        ('c6f5c79fc1d53a3eba85f297f21fdf7d9e3f6685c2602523c2b6638fdf661b78', 1795020304509::bigint),
        ('80a0f331936201035db3ca674973875a371b1fe0c97a2ed654dd09bf1b1177a8', 1795020621739::bigint),
        ('0132f6a637a20888606fb7d2ba861387b05468a999b82e9f9ec9d06a52033a6d', 1795445450301::bigint)
      ) AS expected(hash, created_at)
      WHERE actual.hash = expected.hash
        AND actual.created_at = expected.created_at
    )
  ) THEN
    RAISE EXCEPTION 'The migration journal contains an unexpected entry. Inspect it before continuing.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM drizzle.__drizzle_migrations
    WHERE created_at = 1795445450301
      AND hash <> '0132f6a637a20888606fb7d2ba861387b05468a999b82e9f9ec9d06a52033a6d'
  ) THEN
    RAISE EXCEPTION 'A different migration is already recorded at the Phase 6 timestamp. Inspect the journal before continuing.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM drizzle.__drizzle_migrations
    WHERE hash = '0132f6a637a20888606fb7d2ba861387b05468a999b82e9f9ec9d06a52033a6d'
      AND created_at <> 1795445450301
  ) THEN
    RAISE EXCEPTION 'The Phase 6 migration hash is recorded at an unexpected timestamp. Inspect the journal before continuing.';
  END IF;

  IF to_regclass('public.handoff_messages') IS NOT NULL THEN
    SELECT count(*)::integer
    INTO existing_column_count
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'handoff_messages'
      AND column_name IN ('id', 'order_id', 'sender_user_id', 'action_id', 'body', 'created_at');

    IF existing_column_count <> 6 THEN
      RAISE EXCEPTION 'public.handoff_messages exists with an unexpected schema. Inspect it before continuing.';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM (VALUES
        ('id', 'uuid', NULL::integer, 'NO', 'gen_random_uuid()'::text),
        ('order_id', 'uuid', NULL::integer, 'NO', NULL::text),
        ('sender_user_id', 'uuid', NULL::integer, 'NO', NULL::text),
        ('action_id', 'uuid', NULL::integer, 'NO', NULL::text),
        ('body', 'character varying', 1200, 'NO', NULL::text),
        ('created_at', 'timestamp with time zone', NULL::integer, 'NO', 'now()'::text)
      ) AS expected(column_name, data_type, max_length, is_nullable, column_default)
      LEFT JOIN information_schema.columns actual
        ON actual.table_schema = 'public'
        AND actual.table_name = 'handoff_messages'
        AND actual.column_name = expected.column_name
      WHERE actual.column_name IS NULL
        OR actual.data_type <> expected.data_type
        OR actual.character_maximum_length IS DISTINCT FROM expected.max_length
        OR actual.is_nullable <> expected.is_nullable
        OR actual.column_default IS DISTINCT FROM expected.column_default
    ) THEN
      RAISE EXCEPTION 'public.handoff_messages has unexpected column definitions. Inspect it before continuing.';
    END IF;
  END IF;
END
$preflight$;

CREATE TABLE IF NOT EXISTS public.handoff_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  order_id uuid NOT NULL,
  sender_user_id uuid NOT NULL,
  action_id uuid NOT NULL,
  body varchar(1200) NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

DO $constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'handoff_messages_body_nonempty'
      AND conrelid = 'public.handoff_messages'::regclass
  ) THEN
    ALTER TABLE public.handoff_messages
      ADD CONSTRAINT handoff_messages_body_nonempty
      CHECK (length(btrim(body)) > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'handoff_messages_order_id_orders_id_fk'
      AND conrelid = 'public.handoff_messages'::regclass
  ) THEN
    ALTER TABLE public.handoff_messages
      ADD CONSTRAINT handoff_messages_order_id_orders_id_fk
      FOREIGN KEY (order_id) REFERENCES public.orders(id)
      ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'handoff_messages_sender_user_id_users_id_fk'
      AND conrelid = 'public.handoff_messages'::regclass
  ) THEN
    ALTER TABLE public.handoff_messages
      ADD CONSTRAINT handoff_messages_sender_user_id_users_id_fk
      FOREIGN KEY (sender_user_id) REFERENCES public.users(id)
      ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END
$constraints$;

CREATE INDEX IF NOT EXISTS handoff_messages_order_created_idx
  ON public.handoff_messages USING btree (order_id, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS handoff_messages_sender_action_uidx
  ON public.handoff_messages USING btree (sender_user_id, action_id);

INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
SELECT
  '0132f6a637a20888606fb7d2ba861387b05468a999b82e9f9ec9d06a52033a6d',
  1795445450301
WHERE NOT EXISTS (
  SELECT 1
  FROM drizzle.__drizzle_migrations
  WHERE hash = '0132f6a637a20888606fb7d2ba861387b05468a999b82e9f9ec9d06a52033a6d'
    AND created_at = 1795445450301
);

COMMIT;

-- Read-only verification.
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'handoff_messages'
ORDER BY ordinal_position;

SELECT hash, created_at
FROM drizzle.__drizzle_migrations
WHERE created_at = 1795445450301;
