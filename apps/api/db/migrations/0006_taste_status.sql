-- Migration 0006 — to-taste (想吃清单): tastes.status + nullable verdict.
-- Additive: existing rows default to status='tasted' and keep their verdict.

ALTER TABLE tastes
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'tasted'
    CHECK (status IN ('tasted','todo'));

-- Allow verdict NULL only for todo rows. The original value CHECK
-- (verdict IN ('yum','meh','nah')) evaluates to NULL (=pass) for NULL verdicts,
-- so it stays untouched; this new constraint pins the tasted⇒NOT NULL rule.
ALTER TABLE tastes ALTER COLUMN verdict DROP NOT NULL;
ALTER TABLE tastes
  ADD CONSTRAINT tastes_status_verdict_check
    CHECK (status <> 'tasted' OR verdict IS NOT NULL);

CREATE INDEX IF NOT EXISTS tastes_user_status_created_idx
  ON tastes (user_id, status, created_at DESC);
