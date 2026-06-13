-- Migration 0008 — S3b taster persona + family container.
-- Additive: a taster is an owner-account-scoped persona (no separate login).
-- Every existing user gets exactly one is_self taster (backfill below) and their
-- historical tastes are pointed at it; new registrations auto-create a self-taster
-- in app code (ensureSelfTaster). See docs/product/plans/share-and-circles.md §S3b.

-- Family is, this phase, just a container an owner may hang multiple tasters under.
-- Real cross-account member linking is explicitly out of scope (later phase).
CREATE TABLE IF NOT EXISTS families (
  id         text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  owner_id   text        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       text        NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS families_owner_idx ON families (owner_id);

CREATE TABLE IF NOT EXISTS tasters (
  id               text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  owner_account_id text        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id        text        REFERENCES families(id) ON DELETE SET NULL,
  display_name     text        NOT NULL,
  avatar           text        NOT NULL DEFAULT '',
  is_self          boolean     NOT NULL DEFAULT false,  -- owner's own default taster
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tasters_owner_idx ON tasters (owner_account_id);

-- At most one is_self taster per account. ensureSelfTaster is SELECT-then-INSERT
-- across two statements, so without this guard two concurrent first-saves (or a
-- registration racing the first POST) could both miss the SELECT and insert two
-- is_self rows — after which LIMIT 1 / is_self DESC silently splits attribution.
-- The partial unique index makes the second insert conflict; ensureSelfTaster
-- uses ON CONFLICT DO NOTHING then re-SELECTs the winning row.
CREATE UNIQUE INDEX IF NOT EXISTS tasters_one_self_per_owner
  ON tasters (owner_account_id) WHERE is_self;

-- Attribute a taste to a taster. Nullable: legacy rows are backfilled to the
-- owner's self-taster; ON DELETE SET NULL so deleting a (non-self) persona never
-- cascades away the food log it recorded.
ALTER TABLE tastes ADD COLUMN IF NOT EXISTS taster_id text REFERENCES tasters(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS tastes_taster_idx ON tastes (taster_id, created_at DESC);

-- ── Backfill: one is_self taster per existing user, point their tastes at it ──
-- Idempotent: only creates a self-taster for users that don't already have one,
-- and only assigns tastes that are still unattributed (taster_id IS NULL).
INSERT INTO tasters (owner_account_id, display_name, is_self)
SELECT u.id, COALESCE(NULLIF(u.display_name, ''), 'Me'), true
FROM users u
WHERE NOT EXISTS (
  SELECT 1 FROM tasters t WHERE t.owner_account_id = u.id AND t.is_self = true
);

UPDATE tastes ta
SET taster_id = (
  SELECT t.id FROM tasters t
  WHERE t.owner_account_id = ta.user_id AND t.is_self = true
  LIMIT 1
)
WHERE ta.taster_id IS NULL;

-- ── S3b-media capability flag ─────────────────────────────────────────────────
-- A standalone boolean (NOT a plan-enum change): free/普通 pro = false, the media
-- upgrade tier flips it true. Gates video / live-photo uploads server-side.
ALTER TABLE users ADD COLUMN IF NOT EXISTS media_enabled boolean NOT NULL DEFAULT false;
