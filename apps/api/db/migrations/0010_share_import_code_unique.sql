-- Migration 0010 — enforce UNIQUE import_code per live share token (security fix).
--
-- Context: migration 0007 created share_tokens.import_code with a NON-unique
-- partial index. With CODE_LENGTH=6 (~30 bits) distinct live tokens could hash to
-- the same import code, and resolveImportCode (LIMIT 1) would return an arbitrary
-- matching token — one user's printed code could resolve to ANOTHER user's share.
--
-- This migration replaces the non-unique index with a UNIQUE partial index and
-- CODE_LENGTH is bumped to 10 (~49.5 bits) in the application layer (share-token.ts).
-- Together they make collisions negligibly rare AND impossible to persist.
--
-- Additive at the index level; no column or table is altered.

-- Drop the old non-unique partial index (idempotent).
DROP INDEX IF EXISTS share_tokens_import_code_idx;

-- Unique partial index: at most one live (non-revoked) token may carry any given
-- import code. The INSERT in createShareToken retries on 23505 (unique_violation)
-- with a freshly minted token so the rare collision is resolved transparently.
CREATE UNIQUE INDEX IF NOT EXISTS share_tokens_import_code_unique_idx
  ON share_tokens (import_code) WHERE revoked = false;
