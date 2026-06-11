-- Migration 0006 — to-taste (想吃清单): tastes.status + nullable verdict.
-- Additive: existing rows default to status='tasted' and keep their verdict.

ALTER TABLE tastes
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'tasted'
    CHECK (status IN ('tasted','todo'));

-- Allow verdict NULL only for todo rows. The original value CHECK
-- (verdict IN ('yum','meh','nah')) evaluates to NULL (=pass) for NULL verdicts,
-- so it stays untouched; this new constraint pins the tasted⇒NOT NULL rule.
ALTER TABLE tastes ALTER COLUMN verdict DROP NOT NULL;

-- Add the implication CHECK as NOT VALID first: this skips the full-table
-- validation scan, so the ADD takes only a brief ACCESS EXCLUSIVE lock to record
-- the constraint instead of holding it for the duration of a scan over every
-- existing row. The constraint is enforced for all new/updated rows immediately.
-- VALIDATE then checks the pre-existing rows under a weaker (SHARE UPDATE
-- EXCLUSIVE) lock that does not block reads/writes. All existing rows are
-- status='tasted' with a non-null verdict (the column was NOT NULL until the
-- ALTER above), so VALIDATE cannot fail here.
-- NOTE: if this migration is ever applied as one batched/transactional run, the
-- split buys nothing (both statements share the txn lock) but is still correct;
-- it pays off when run statement-by-statement (psql \i / separate -c), matching
-- how 0001–0005 were authored as standalone additive files.
ALTER TABLE tastes
  ADD CONSTRAINT tastes_status_verdict_check
    CHECK (status <> 'tasted' OR verdict IS NOT NULL) NOT VALID;
ALTER TABLE tastes VALIDATE CONSTRAINT tastes_status_verdict_check;

-- Plain CREATE INDEX (not CONCURRENTLY) to match the 0001–0005 convention and
-- because CONCURRENTLY cannot run inside a transaction block (it would error if
-- the file is applied as a single batched query, which is the runner pattern
-- here). The tastes table is small (per-user food logs), so the brief build
-- lock is acceptable.
CREATE INDEX IF NOT EXISTS tastes_user_status_created_idx
  ON tastes (user_id, status, created_at DESC);
