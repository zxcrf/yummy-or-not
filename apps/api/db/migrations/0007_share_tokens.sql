-- Migration 0007 — S3a single-card share → import into recipient to-taste.
--
-- THIN POINTER ONLY (review翻修): share_tokens stores no jsonb snapshot and no
-- copied photo key. Preview reads the source taste LIVE by taste_id and mints a
-- short token-gated presign of the ORIGINAL R2 object. The snapshot semantics
-- are realized only at import time (copy-on-import into the importer's library),
-- recorded in taste_imports for provenance + idempotency.
--
-- Additive only: no existing table is altered.

-- ── share_tokens — the mintable, revocable, non-enumerable pointer ────────────
-- token is the crypto-random PRIMARY KEY (non-enumerable). No per-share storage
-- beyond the pointer + revocation/expiry flags.
CREATE TABLE IF NOT EXISTS share_tokens (
  token       text        PRIMARY KEY,             -- crypto-random, non-enumerable
  taste_id    text        NOT NULL REFERENCES tastes(id) ON DELETE CASCADE,
  owner_id    text        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- import_code is the SHORT, token-DERIVED "magic word" printed on the share
  -- card (WeChat strips the deep link, so the recipient types this code). Stored
  -- + indexed so resolve is an O(1) indexed lookup, NOT a full scan that
  -- re-derives the code for every live token (which also amplified DoS as the
  -- table grew). Computed at mint via importCodeFor(token).
  import_code text,
  revoked     boolean     NOT NULL DEFAULT false,
  expires_at  timestamptz,                         -- null = no expiry (owner may still revoke)
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS share_tokens_owner_idx ON share_tokens (owner_id, created_at DESC);
-- Indexed resolve of the printed code → token, scoped to live tokens. Partial
-- index keeps it small and lets resolveImportCode stay O(1) (no full scan).
CREATE INDEX IF NOT EXISTS share_tokens_import_code_idx
  ON share_tokens (import_code) WHERE revoked = false;

-- ── taste_imports — provenance + idempotency for copy-on-import ───────────────
-- One row per (token, importer): UNIQUE(from_token, importer_id) makes a repeat
-- import of the same share a no-op that returns the existing copy.
CREATE TABLE IF NOT EXISTS taste_imports (
  id           text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  taste_id     text        NOT NULL REFERENCES tastes(id) ON DELETE CASCADE,  -- the copy in the importer's library
  from_token   text        REFERENCES share_tokens(token) ON DELETE SET NULL,
  from_user_id text        REFERENCES users(id) ON DELETE SET NULL,           -- source owner (provenance)
  importer_id  text        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (from_token, importer_id)                 -- same importer + same token → idempotent
);
CREATE INDEX IF NOT EXISTS taste_imports_importer_idx ON taste_imports (importer_id, created_at DESC);
