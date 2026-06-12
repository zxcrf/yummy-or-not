-- Migration 0005 — L1 location capture opt-in + taste coordinates.
-- ADDITIVE and idempotent: IF NOT EXISTS guards make re-runs safe.

ALTER TABLE tastes
  ADD COLUMN IF NOT EXISTS lat double precision,
  ADD COLUMN IF NOT EXISTS lng double precision;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS location_enabled boolean NOT NULL DEFAULT false;
