// S3b Phase 2 — migration 0012 shape + media-invariant CHECK.
//
// Two parts:
//  A. STATIC shape (mirrors visibility-migration-shape.test.ts): pin that the
//     on-disk 0012 migration declares media_type/clip_key/duration_ms with
//     ⟦DR#6⟧ idempotent guards (ADD COLUMN IF NOT EXISTS + pg_constraint guard
//     for BOTH CHECKs) so a missing column/constraint can't reach prod as a 500.
//  B. RUNTIME invariant: build a tastes table carrying the same media CHECKs
//     (inline, mirroring schema.sql — pg-mem can't run a `DO $$` block) and prove
//     ⟦DR#2⟧ the invariant rejects an image row with a clip / a video row without
//     one, and accepts the two legal shapes.

import { readFileSync, readdirSync } from 'fs';
import path from 'path';
import { newDb } from 'pg-mem';

const ROOT = path.resolve(__dirname, '../../../');
const MIGRATIONS_DIR = path.join(ROOT, 'db', 'migrations');

function readMigration(prefix: string): string {
  const f = readdirSync(MIGRATIONS_DIR)
    .filter((n) => n.endsWith('.sql'))
    .sort()
    .find((n) => n.startsWith(prefix));
  if (!f) throw new Error(`migration ${prefix}_*.sql not found`);
  return readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8').toLowerCase();
}

describe('migration 0012 — media columns + invariant (static shape)', () => {
  it('exists with the FIXED 0012 number', () => {
    const f = readdirSync(MIGRATIONS_DIR).find((n) => n.startsWith('0012_'));
    expect(f).toBeDefined();
  });

  it('⟦DR#6⟧ adds the three media columns with ADD COLUMN IF NOT EXISTS (idempotent)', () => {
    const sql = readMigration('0012_');
    expect(sql).toMatch(/add\s+column\s+if\s+not\s+exists\s+media_type\s+text\s+not\s+null\s+default\s+'image'/);
    expect(sql).toMatch(/add\s+column\s+if\s+not\s+exists\s+clip_key\s+text/);
    expect(sql).toMatch(/add\s+column\s+if\s+not\s+exists\s+duration_ms\s+integer/);
  });

  it('⟦DR#6⟧ guards the media_type domain CHECK behind a pg_constraint existence test', () => {
    const sql = readMigration('0012_');
    // A DO $$ block that only ADDs the constraint when it is absent (rerun-safe).
    expect(sql).toMatch(/do\s+\$\$[\s\S]*pg_constraint[\s\S]*media_type[\s\S]*in\s*\(\s*'image'\s*,\s*'video'\s*\)[\s\S]*\$\$/);
  });

  it('⟦DR#2/DR#6⟧ guards the media-invariant CHECK behind a pg_constraint existence test', () => {
    const sql = readMigration('0012_');
    expect(sql).toMatch(/pg_constraint/);
    // The invariant: image⇒clip NULL & duration NULL, video⇒clip NOT NULL.
    expect(sql).toMatch(/media_type\s*=\s*'image'\s+and\s+clip_key\s+is\s+null\s+and\s+duration_ms\s+is\s+null/);
    expect(sql).toMatch(/media_type\s*=\s*'video'\s+and\s+clip_key\s+is\s+not\s+null/);
  });
});

describe('migration 0012 — media invariant CHECK enforces ⟦DR#2⟧ at the DB', () => {
  // Mirror schema.sql's tastes media constraints inline (pg-mem applies CHECKs but
  // cannot execute the migration's DO $$ guard form). This proves the invariant
  // the migration installs actually rejects the illegal shapes.
  function freshDb() {
    const db = newDb();
    db.public.none(`
      CREATE TABLE tastes (
        id          text PRIMARY KEY DEFAULT 'x',
        media_type  text NOT NULL DEFAULT 'image' CHECK (media_type IN ('image','video')),
        clip_key    text,
        duration_ms integer,
        CONSTRAINT tastes_media_invariant_check CHECK (
          (media_type = 'image' AND clip_key IS NULL AND duration_ms IS NULL)
          OR
          (media_type = 'video' AND clip_key IS NOT NULL)
        )
      );
    `);
    return db;
  }

  it('accepts a plain image row (no clip, no duration)', () => {
    const db = freshDb();
    expect(() =>
      db.public.none(`INSERT INTO tastes (id, media_type) VALUES ('a', 'image')`)
    ).not.toThrow();
  });

  it('accepts a video row with a clip_key', () => {
    const db = freshDb();
    expect(() =>
      db.public.none(`INSERT INTO tastes (id, media_type, clip_key, duration_ms) VALUES ('b', 'video', 'u/u1/clips/x/clip.mp4', 8000)`)
    ).not.toThrow();
  });

  it('REJECTS an image row that carries a clip_key', () => {
    const db = freshDb();
    expect(() =>
      db.public.none(`INSERT INTO tastes (id, media_type, clip_key) VALUES ('c', 'image', 'u/u1/clips/x/clip.mp4')`)
    ).toThrow();
  });

  it('REJECTS an image row that carries a duration_ms', () => {
    const db = freshDb();
    expect(() =>
      db.public.none(`INSERT INTO tastes (id, media_type, duration_ms) VALUES ('d', 'image', 8000)`)
    ).toThrow();
  });

  it('REJECTS a video row with NO clip_key', () => {
    const db = freshDb();
    expect(() =>
      db.public.none(`INSERT INTO tastes (id, media_type) VALUES ('e', 'video')`)
    ).toThrow();
  });

  it('REJECTS an out-of-domain media_type', () => {
    const db = freshDb();
    expect(() =>
      db.public.none(`INSERT INTO tastes (id, media_type, clip_key) VALUES ('f', 'audio', 'k')`)
    ).toThrow();
  });
});
