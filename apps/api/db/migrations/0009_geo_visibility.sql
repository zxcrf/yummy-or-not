-- Migration 0009 — S3c geo visibility + targeted publish + grid heat.
-- See docs/product/plans/share-and-circles.md §S3c.
--
-- Prerequisite 0009a (folded to the TOP of this file so it runs BEFORE the
-- geography column): CREATE EXTENSION postgis. The migrate runner applies files
-- in LEXICAL order and "0009a_*.sql" would sort AFTER "0009_*.sql" — so the
-- geography(Point,4326) column would error with `type "geography" does not exist`.
-- Folding CREATE EXTENSION into the top of 0009 keeps extension-before-geography
-- without a separate-file ordering trap. IF NOT EXISTS makes it idempotent and
-- backup/restore-safe (a restore that re-runs migrations does not double-create).
CREATE EXTENSION IF NOT EXISTS postgis;

-- ── Per-record default visibility (overridden per taste by targeted publish) ───
-- 'private' (default — never appears in any cross-user feed) or 'shared' (at
-- least one targeted publish exists in taste_shares). Old rows default private:
-- nothing becomes visible until the owner explicitly publishes it.
ALTER TABLE tastes ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'private'
  CHECK (visibility IN ('private', 'shared'));

-- The You-page "new records default to" row binds this. Default private so a
-- fresh account leaks nothing by accident.
ALTER TABLE users ADD COLUMN IF NOT EXISTS default_visibility text NOT NULL DEFAULT 'private'
  CHECK (default_visibility IN ('private', 'shared'));

-- ── Targeted publish: one taste may be published to several targets ───────────
-- geo publish DOUBLE-WRITES geog (PostGIS radius query engine) + grid_cell
-- (geohash precision 5 — heat aggregation + the coarsened position shown to
-- others). The two are orthogonal: geog = query, grid_cell = display/privacy.
CREATE TABLE IF NOT EXISTS taste_shares (
  id          text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  taste_id    text        NOT NULL REFERENCES tastes(id) ON DELETE CASCADE,
  owner_id    text        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type text        NOT NULL CHECK (target_type IN ('geo', 'family', 'member')),
  -- family_id / member (taster_id, or a future user_id). NULL for geo.
  target_id   text,
  -- geo only: the geography point ST_DWithin runs against.
  geog        geography(Point, 4326),
  -- geo only: geohash precision 5 — coarsened cell (privacy) + heat bucket.
  grid_cell   text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  -- Geo consistency: a geo share MUST carry both the geography point (radius
  -- query engine) and the coarsened grid_cell (heat + privacy display). Without
  -- this a geo row could be written with a null geog (invisible to ST_DWithin)
  -- or a null grid_cell (no heat bucket / no coarsened position). Non-geo rows
  -- are unconstrained (they carry neither). DB-level guard so no caller — not
  -- just the route — can persist a half-written geo share.
  CONSTRAINT taste_shares_geo_complete
    CHECK (target_type != 'geo' OR (geog IS NOT NULL AND grid_cell IS NOT NULL))
);

-- GiST index for the radius query, scoped to geo rows (only they carry geog).
CREATE INDEX IF NOT EXISTS taste_shares_geog_idx  ON taste_shares USING GIST (geog) WHERE target_type = 'geo';
-- grid_cell index drives the heat aggregation / cell card stream.
CREATE INDEX IF NOT EXISTS taste_shares_grid_idx  ON taste_shares (grid_cell)       WHERE target_type = 'geo';
-- (target_type,target_id) index drives the family / member feed lookups.
CREATE INDEX IF NOT EXISTS taste_shares_target_idx ON taste_shares (target_type, target_id);
