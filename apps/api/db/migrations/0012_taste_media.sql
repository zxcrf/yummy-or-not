-- Migration 0012 — S3b-media Phase 2: video on taste cards.
-- See docs/product/plans/s3b-media.md §3 (D3) + .omc/state/s3b-phase2-contract.md §A.
--
-- Adds three columns to `tastes`:
--   media_type  — 'image' (default) | 'video'. Absent ≡ 'image' for old rows.
--   clip_key    — private R2 key of the video clip (u/{userId}/clips/{uuid}/clip.{ext}).
--                 NULL on image rows; NOT NULL on video rows (invariant below).
--   duration_ms — clip length in ms (≤15000). NULL on image rows.
-- `image` stays the POSTER key (reuses the variant + read-resolver path unchanged):
-- a video record's poster rides the normal photo pipeline; the clip is the new
-- private sibling object.
--
-- ⟦DR#6⟧ FULLY IDEMPOTENT: ADD COLUMN IF NOT EXISTS + a pg_constraint guard for
-- each CHECK. A bare `ADD CONSTRAINT` errors on rerun / baseline drift (the
-- constraint may already exist from schema.sql or a prior partial apply); the
-- `IF NOT EXISTS (SELECT FROM pg_constraint WHERE conname=…)` guard makes the
-- whole file re-runnable and backup/restore-safe.
--
-- ⟦DR#6 ops⟧ Prod does NOT auto-run migrations on deploy (migration-runner-gap):
-- apply 0012 explicitly via psql pipe, NOT the in-container runner.

ALTER TABLE tastes ADD COLUMN IF NOT EXISTS media_type  text NOT NULL DEFAULT 'image';
ALTER TABLE tastes ADD COLUMN IF NOT EXISTS clip_key    text;
ALTER TABLE tastes ADD COLUMN IF NOT EXISTS duration_ms integer;

-- media_type domain: only 'image' or 'video'.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tastes_media_type_check'
  ) THEN
    ALTER TABLE tastes
      ADD CONSTRAINT tastes_media_type_check
      CHECK (media_type IN ('image', 'video'));
  END IF;
END $$;

-- ⟦DR#2⟧ media invariant: an image row carries NO clip; a video row MUST carry a
-- clip_key. duration_ms is required-null on image rows (a clip length on an image
-- row is meaningless) and free on video rows. This is the DB backstop for the
-- early route reject in POST /api/tastes.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tastes_media_invariant_check'
  ) THEN
    ALTER TABLE tastes
      ADD CONSTRAINT tastes_media_invariant_check
      CHECK (
        (media_type = 'image' AND clip_key IS NULL AND duration_ms IS NULL)
        OR
        (media_type = 'video' AND clip_key IS NOT NULL)
      );
  END IF;
END $$;
