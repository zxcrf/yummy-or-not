-- Migration 0005 — L1 location capture opt-in + taste coordinates.

ALTER TABLE tastes ADD COLUMN lat double precision, ADD COLUMN lng double precision;

ALTER TABLE users ADD COLUMN location_enabled boolean NOT NULL DEFAULT false;
