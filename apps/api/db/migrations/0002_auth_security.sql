-- Migration 0002 — session token hashing + auth rate limits.
-- ADDITIVE/compatible: old plaintext session tokens remain readable until they
-- expire, while new sessions write only token_hash.

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS token_hash text;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sessions_pkey'
      AND conrelid = 'sessions'::regclass
  ) THEN
    ALTER TABLE sessions DROP CONSTRAINT sessions_pkey;
  END IF;
END $$;

ALTER TABLE sessions ALTER COLUMN token DROP NOT NULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sessions_token_or_hash_check'
      AND conrelid = 'sessions'::regclass
  ) THEN
    ALTER TABLE sessions ADD CONSTRAINT sessions_token_or_hash_check
      CHECK (token IS NOT NULL OR token_hash IS NOT NULL) NOT VALID;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS sessions_token_hash_key
  ON sessions (token_hash)
  WHERE token_hash IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS sessions_token_key
  ON sessions (token)
  WHERE token IS NOT NULL;

CREATE TABLE IF NOT EXISTS rate_limits (
  key        text        PRIMARY KEY,
  count      int         NOT NULL DEFAULT 0,
  reset_at   timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rate_limits_reset_idx ON rate_limits (reset_at);
