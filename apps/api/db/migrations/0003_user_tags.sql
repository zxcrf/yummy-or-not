-- Migration 0003 — user_tags candidate-set table.
-- ADDITIVE: creates new table only; no changes to existing tables or columns.

CREATE TABLE IF NOT EXISTS user_tags (
  id         text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id    text        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Case-insensitive uniqueness: `Boba` and `boba` are the same tag for the same user.
CREATE UNIQUE INDEX IF NOT EXISTS user_tags_user_name_ci_key
  ON user_tags (user_id, lower(name));

CREATE INDEX IF NOT EXISTS user_tags_user_idx ON user_tags (user_id, name ASC);
