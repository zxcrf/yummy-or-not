-- Migration 0011 — self-serve email password reset.
-- Stores ONLY the sha256 hash of a single-use, time-boxed reset token (the raw
-- token is mailed to the user and never persisted). A successful reset marks
-- used_at so the token cannot be replayed; expires_at caps its lifetime.

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  token_hash text        PRIMARY KEY,
  user_id    text        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email      text,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS password_reset_tokens_expires_idx
  ON password_reset_tokens (expires_at);
