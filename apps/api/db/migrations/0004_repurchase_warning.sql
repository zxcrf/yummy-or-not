-- Migration 0004 — repurchase warning + purchases ledger.
-- ADDITIVE: new columns (with safe defaults) and new table only.
-- No existing columns are altered or dropped.

-- ── New columns on tastes ─────────────────────────────────────────────────────
ALTER TABLE tastes
  ADD COLUMN IF NOT EXISTS warn_before_buy boolean NOT NULL DEFAULT false;

-- ── New column on users ───────────────────────────────────────────────────────
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS warnings_enabled boolean NOT NULL DEFAULT true;

-- ── Purchases ledger ──────────────────────────────────────────────────────────
-- Each row represents one additional purchase of a taste beyond the original.
-- boughtCount derived = 1 + COUNT(*) from this table for the taste.
CREATE TABLE IF NOT EXISTS taste_purchases (
  id         text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  taste_id   text        NOT NULL REFERENCES tastes(id) ON DELETE CASCADE,
  price      numeric(10,2),           -- NULL means "same as taste.price" — up to client
  place      text,                    -- NULL means "same as taste.place"
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS taste_purchases_taste_idx ON taste_purchases (taste_id, created_at DESC);

-- ── Backfill ──────────────────────────────────────────────────────────────────
-- For tastes with bought_count > 1, insert (bought_count - 1) historical purchase
-- rows. We use the taste's own price (cast to numeric) and place, and spread them
-- at 1-second intervals before created_at so ORDER BY created_at DESC is stable.
--
-- Idempotency guard: the NOT EXISTS subquery skips any taste that already has at
-- least one row in taste_purchases. Re-running this migration is therefore a
-- no-op for already-backfilled tastes — no duplicate rows can appear.
INSERT INTO taste_purchases (taste_id, price, place, created_at)
SELECT
  t.id                                                        AS taste_id,
  NULLIF(REGEXP_REPLACE(t.price, '[^0-9.]', '', 'g'), '')::numeric AS price,
  NULLIF(t.place, '')                                         AS place,
  t.created_at - (gs.n * interval '1 second')                AS created_at
FROM tastes t
CROSS JOIN LATERAL generate_series(1, GREATEST(t.bought_count - 1, 0)) AS gs(n)
WHERE t.bought_count > 1
  AND NOT EXISTS (
    SELECT 1 FROM taste_purchases p WHERE p.taste_id = t.id
  );
