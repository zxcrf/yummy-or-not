-- Yummy or Not — multi-user schema.
-- Drops in dependency order so a re-run is a clean rebuild.
DROP TABLE IF EXISTS taste_shares;
DROP TABLE IF EXISTS promo_redemptions;
DROP TABLE IF EXISTS promo_codes;
DROP TABLE IF EXISTS taste_purchases;
DROP TABLE IF EXISTS otp_codes;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS auth_identities;
DROP TABLE IF EXISTS tastes;
DROP TABLE IF EXISTS users;

-- PostGIS (S3c) — geography type + ST_DWithin for the cross-user geo radius feed.
-- IF NOT EXISTS so a re-run / restore is safe; declared first because taste_shares
-- below uses geography(Point,4326).
CREATE EXTENSION IF NOT EXISTS postgis;

-- ── Users ──────────────────────────────────────────────────────────────────
-- A user is identified by a phone (domestic habit) and/or an email
-- (international habit). Either can be null; at least one auth handle exists.
CREATE TABLE users (
  id               text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  display_name     text        NOT NULL DEFAULT '',
  phone            text        UNIQUE,             -- E.164-ish, e.g. +8613800138000
  email            text        UNIQUE,             -- lower-cased on write
  password_hash    text,                           -- scrypt "salt:hash"; null for OTP/OAuth-only
  avatar           text        NOT NULL DEFAULT '',
  locale           text        NOT NULL DEFAULT 'zh',
  plan             text        NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro')),
  warnings_enabled boolean     NOT NULL DEFAULT true,
  location_enabled boolean     NOT NULL DEFAULT false,
  -- S3b-media capability flag (NOT a plan-enum change): gates video/live-photo uploads.
  media_enabled    boolean     NOT NULL DEFAULT false,
  -- S3c: default visibility for NEW records (the You-page row binds this).
  default_visibility text      NOT NULL DEFAULT 'private' CHECK (default_visibility IN ('private', 'shared')),
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- ── OAuth / social identities (WeChat, Google, Apple, …) ─────────────────────
-- One row per linked external account. (provider, provider_uid) is unique so a
-- social login always resolves to the same user.
CREATE TABLE auth_identities (
  id           text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id      text        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider     text        NOT NULL,            -- 'wechat' | 'google' | 'apple'
  provider_uid text        NOT NULL,            -- stable id from the provider
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_uid)
);
CREATE INDEX auth_identities_user_idx ON auth_identities (user_id);

-- ── Sessions ─────────────────────────────────────────────────────────────────
-- Opaque token stored server-side; carried as a bearer token (Authorization
-- header) and/or cookie. Server-side storage lets us revoke (logout / "sign out
-- everywhere") without trusting the client.
CREATE TABLE sessions (
  token       text        UNIQUE,
  token_hash  text        UNIQUE,
  user_id     text        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_agent  text        NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  CONSTRAINT sessions_token_or_hash_check CHECK (token IS NOT NULL OR token_hash IS NOT NULL)
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

-- ── Rate limits ─────────────────────────────────────────────────────────────
CREATE TABLE rate_limits (
  key        text        PRIMARY KEY,
  count      int         NOT NULL DEFAULT 0,
  reset_at   timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX rate_limits_reset_idx ON rate_limits (reset_at);

-- ── One-time codes (phone SMS OTP) ───────────────────────────────────────────
CREATE TABLE otp_codes (
  id          bigserial   PRIMARY KEY,
  phone       text        NOT NULL,
  code_hash   text        NOT NULL,            -- sha256(code) — never store the raw code
  expires_at  timestamptz NOT NULL,
  consumed    boolean     NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX otp_codes_phone_idx ON otp_codes (phone, created_at DESC);

-- ── Tastes (now owned by a user) ─────────────────────────────────────────────
CREATE TABLE tastes (
  id             text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id        text        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name           text        NOT NULL,
  place          text        NOT NULL DEFAULT '',
  price          text        NOT NULL DEFAULT '',
  -- status: 'tasted' (default, scored) or 'todo' (想吃 wishlist, verdict may be NULL).
  status         text        NOT NULL DEFAULT 'tasted' CHECK (status IN ('tasted', 'todo')),
  -- verdict is NULL only for todo rows; the implication CHECK below pins tasted⇒NOT NULL.
  verdict        text        CHECK (verdict IN ('yum', 'meh', 'nah')),
  tags           text[]      NOT NULL DEFAULT '{}',
  bought_count   int         NOT NULL DEFAULT 1,   -- legacy counter; reads use derived 1+COUNT(taste_purchases)
  warn_before_buy boolean    NOT NULL DEFAULT false,
  notes          text        NOT NULL DEFAULT '',
  image          text        NOT NULL DEFAULT '',
  lat            double precision,
  lng            double precision,
  -- S3b: attribute a taste to a taster persona (nullable; defaults to the
  -- owner's self-taster, backfilled). FK declared after the tasters table below.
  taster_id      text,
  -- S3c: 'private' (default — never in any cross-user feed) or 'shared' (≥1 publish).
  visibility     text        NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'shared')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tastes_status_verdict_check CHECK (status <> 'tasted' OR verdict IS NOT NULL)
);

-- Per-user, newest-first queries (the hot path)
CREATE INDEX tastes_user_created_idx ON tastes (user_id, created_at DESC);

-- ── Families + tasters (S3b — owner-scoped personas, no separate login) ───────
CREATE TABLE families (
  id         text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  owner_id   text        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       text        NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX families_owner_idx ON families (owner_id);

CREATE TABLE tasters (
  id               text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  owner_account_id text        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id        text        REFERENCES families(id) ON DELETE SET NULL,
  display_name     text        NOT NULL,
  avatar           text        NOT NULL DEFAULT '',
  is_self          boolean     NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tasters_owner_idx ON tasters (owner_account_id);
-- At most one is_self taster per account (guards the ensureSelfTaster race; see
-- migration 0008). ensureSelfTaster relies on this for its ON CONFLICT DO NOTHING.
CREATE UNIQUE INDEX tasters_one_self_per_owner ON tasters (owner_account_id) WHERE is_self;

-- Attribute tastes to a taster (ON DELETE SET NULL: deleting a persona never
-- cascades away its food log). FK added here because tasters is defined above.
ALTER TABLE tastes ADD CONSTRAINT tastes_taster_id_fkey
  FOREIGN KEY (taster_id) REFERENCES tasters(id) ON DELETE SET NULL;
CREATE INDEX tastes_taster_idx ON tastes (taster_id, created_at DESC);

-- Per-user, status-partitioned newest-first (Library 已尝/想吃 segments)
CREATE INDEX tastes_user_status_created_idx ON tastes (user_id, status, created_at DESC);

-- Fast tag filtering
CREATE INDEX tastes_tags_gin_idx ON tastes USING GIN (tags);

-- ── Targeted publish (S3c — geo / family / member) ────────────────────────────
-- One taste may be published to several targets. geo publish DOUBLE-WRITES geog
-- (PostGIS radius query engine) + grid_cell (geohash precision 5 — heat bucket +
-- the coarsened position shown to others). geog = query, grid_cell = display/privacy.
CREATE TABLE taste_shares (
  id          text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  taste_id    text        NOT NULL REFERENCES tastes(id) ON DELETE CASCADE,
  owner_id    text        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type text        NOT NULL CHECK (target_type IN ('geo', 'family', 'member')),
  target_id   text,                              -- family_id / member; NULL for geo
  geog        geography(Point, 4326),            -- geo only — ST_DWithin radius query
  grid_cell   text,                              -- geo only — geohash p5 (coarsened)
  created_at  timestamptz NOT NULL DEFAULT now(),
  -- Geo consistency: a geo share MUST carry both geog (radius engine) and
  -- grid_cell (heat + coarsened display). Forbids a half-written geo row at the
  -- DB. Non-geo rows are unconstrained (they carry neither). Mirrors migration
  -- 0009's taste_shares_geo_complete so a fresh schema and a migrated DB match.
  CONSTRAINT taste_shares_geo_complete
    CHECK (target_type != 'geo' OR (geog IS NOT NULL AND grid_cell IS NOT NULL))
);
-- GiST radius index, scoped to geo rows (only they carry geog).
CREATE INDEX taste_shares_geog_idx   ON taste_shares USING GIST (geog) WHERE target_type = 'geo';
CREATE INDEX taste_shares_grid_idx   ON taste_shares (grid_cell)       WHERE target_type = 'geo';
CREATE INDEX taste_shares_target_idx ON taste_shares (target_type, target_id);

-- ── Promo codes ──────────────────────────────────────────────────────────────
-- A code grants a plan (e.g. 'pro') when redeemed — at sign-up
-- (RegisterInput.promoCode) or after login (POST /api/promo/redeem).
-- `code` is stored in canonical form (upper-cased, no spaces); see lib/promo.ts.
CREATE TABLE promo_codes (
  code        text        PRIMARY KEY,                 -- e.g. 'YON-PRO-7F3KQ2'
  grants_plan text        NOT NULL DEFAULT 'pro' CHECK (grants_plan IN ('free', 'pro')),
  max_uses    int         NOT NULL DEFAULT 1,          -- <= 0 means unlimited
  used_count  int         NOT NULL DEFAULT 0,
  note        text        NOT NULL DEFAULT '',         -- human label, e.g. "for Alex"
  created_by  text        REFERENCES users(id) ON DELETE SET NULL,
  expires_at  timestamptz,                             -- null = never expires
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ── Promo redemptions ────────────────────────────────────────────────────────
-- One row per (code, user). The UNIQUE constraint makes a second redeem by the
-- same user a no-op (ON CONFLICT) — that's how "already_redeemed" is detected.
CREATE TABLE promo_redemptions (
  id          bigserial   PRIMARY KEY,
  code        text        NOT NULL REFERENCES promo_codes(code) ON DELETE CASCADE,
  user_id     text        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  redeemed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (code, user_id)
);
CREATE INDEX promo_redemptions_user_idx ON promo_redemptions (user_id);

-- ── User tag candidate set ────────────────────────────────────────────────────
-- Each row is one tag name a user has available to apply to future tastes.
-- Deleting a tag here never rewrites historical tastes.tags arrays.
CREATE TABLE user_tags (
  id         text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id    text        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Case-insensitive uniqueness: `Boba` and `boba` are the same tag for the same user.
CREATE UNIQUE INDEX user_tags_user_name_ci_key ON user_tags (user_id, lower(name));

CREATE INDEX user_tags_user_idx ON user_tags (user_id, name ASC);

-- ── Purchases ledger ─────────────────────────────────────────────────────────
-- Each row is one additional purchase of a taste (beyond the original record).
-- Derived boughtCount = 1 + COUNT(*) FROM taste_purchases WHERE taste_id = t.id.
-- Deleting the taste cascades to delete all its purchase rows.
CREATE TABLE taste_purchases (
  id         text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  taste_id   text        NOT NULL REFERENCES tastes(id) ON DELETE CASCADE,
  price      numeric(10,2),           -- NULL = caller did not specify; UI may display taste.price
  place      text,                    -- NULL = caller did not specify; UI may display taste.place
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX taste_purchases_taste_idx ON taste_purchases (taste_id, created_at DESC);
