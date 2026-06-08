-- Migration 0001 — promo codes + redemptions.
-- ADDITIVE and idempotent: safe to run against the live prod DB (which already
-- holds users/tastes data). Unlike schema.sql, this never DROPs anything.

CREATE TABLE IF NOT EXISTS promo_codes (
  code        text        PRIMARY KEY,
  grants_plan text        NOT NULL DEFAULT 'pro' CHECK (grants_plan IN ('free', 'pro')),
  max_uses    int         NOT NULL DEFAULT 1,          -- <= 0 means unlimited
  used_count  int         NOT NULL DEFAULT 0,
  note        text        NOT NULL DEFAULT '',
  created_by  text        REFERENCES users(id) ON DELETE SET NULL,
  expires_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS promo_redemptions (
  id          bigserial   PRIMARY KEY,
  code        text        NOT NULL REFERENCES promo_codes(code) ON DELETE CASCADE,
  user_id     text        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  redeemed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (code, user_id)
);
CREATE INDEX IF NOT EXISTS promo_redemptions_user_idx ON promo_redemptions (user_id);
