-- Yummy or Not — multi-user schema.
-- Drops in dependency order so a re-run is a clean rebuild.
DROP TABLE IF EXISTS otp_codes;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS auth_identities;
DROP TABLE IF EXISTS tastes;
DROP TABLE IF EXISTS users;

-- ── Users ──────────────────────────────────────────────────────────────────
-- A user is identified by a phone (domestic habit) and/or an email
-- (international habit). Either can be null; at least one auth handle exists.
CREATE TABLE users (
  id            text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  display_name  text        NOT NULL DEFAULT '',
  phone         text        UNIQUE,             -- E.164-ish, e.g. +8613800138000
  email         text        UNIQUE,             -- lower-cased on write
  password_hash text,                           -- scrypt "salt:hash"; null for OTP/OAuth-only
  avatar        text        NOT NULL DEFAULT '',
  locale        text        NOT NULL DEFAULT 'zh',
  plan          text        NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro')),
  created_at    timestamptz NOT NULL DEFAULT now()
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
  token       text        PRIMARY KEY,
  user_id     text        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_agent  text        NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

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
  id          text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id     text        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        text        NOT NULL,
  place       text        NOT NULL DEFAULT '',
  price       text        NOT NULL DEFAULT '',
  verdict     text        NOT NULL CHECK (verdict IN ('yum', 'meh', 'nah')),
  tags        text[]      NOT NULL DEFAULT '{}',
  bought_count int        NOT NULL DEFAULT 1,
  notes       text        NOT NULL DEFAULT '',
  image       text        NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Per-user, newest-first queries (the hot path)
CREATE INDEX tastes_user_created_idx ON tastes (user_id, created_at DESC);

-- Fast tag filtering
CREATE INDEX tastes_tags_gin_idx ON tastes USING GIN (tags);
