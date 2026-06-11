-- Yummy or Not — multi-user schema.
-- Drops in dependency order so a re-run is a clean rebuild.
DROP TABLE IF EXISTS promo_redemptions;
DROP TABLE IF EXISTS promo_codes;
DROP TABLE IF EXISTS taste_purchases;
DROP TABLE IF EXISTS otp_codes;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS auth_identities;
DROP TABLE IF EXISTS tastes;
DROP TABLE IF EXISTS users;

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
  verdict        text        NOT NULL CHECK (verdict IN ('yum', 'meh', 'nah')),
  tags           text[]      NOT NULL DEFAULT '{}',
  bought_count   int         NOT NULL DEFAULT 1,   -- legacy counter; reads use derived 1+COUNT(taste_purchases)
  warn_before_buy boolean    NOT NULL DEFAULT false,
  notes          text        NOT NULL DEFAULT '',
  image          text        NOT NULL DEFAULT '',
  lat            double precision,
  lng            double precision,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Per-user, newest-first queries (the hot path)
CREATE INDEX tastes_user_created_idx ON tastes (user_id, created_at DESC);

-- Fast tag filtering
CREATE INDEX tastes_tags_gin_idx ON tastes USING GIN (tags);

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
