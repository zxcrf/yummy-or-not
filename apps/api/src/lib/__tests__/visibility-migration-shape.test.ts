// Static migration-shape guard for S3c (migrations 0009a + 0009), mirroring
// taster-migration-shape.test.ts: pin that the on-disk migrations actually
// declare every structure the S3c feed/visibility helpers rely on, so a missing
// column/index can't reach prod as a runtime 500 (the way the 0006 `status` gap
// did).
//
// What it pins (from docs/product/plans/share-and-circles.md §S3c data model):
//   - migration 0009a exists (FIXED number) and guards CREATE EXTENSION postgis
//     with IF NOT EXISTS (idempotent, backup/restore-safe).
//   - migration 0009 exists with the FIXED number 0009 (not renumbered — S3a=0007,
//     S3b=0008, S3c=0009 are fixed for parallel-branch mergeability).
//   - tastes.visibility ('private'|'shared') default private + the CHECK.
//   - users.default_visibility default private + the CHECK (the You-page row binds
//     this).
//   - taste_shares table with taste_id, owner_id, target_type ('geo'|'family'|
//     'member'), target_id, geog geography(Point,4326), grid_cell, created_at.
//   - GiST index on geog scoped to geo shares, a grid_cell index, and a
//     (target_type,target_id) index — the indexes the radius / heat / family
//     feeds need to be query-able.
//
// FAILS today: db/migrations/0009a_*.sql and 0009_*.sql do not exist. PASSES
// once the migrations ship with the FIXED numbers.

import { readFileSync, readdirSync } from 'fs';
import path from 'path';

// __tests__ → lib → src → apps/api
const ROOT = path.resolve(__dirname, '../../../');
const MIGRATIONS_DIR = path.join(ROOT, 'db', 'migrations');

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
}

/** Read the single migration whose name starts with `prefix` (lower-cased). */
function readMigration(prefix: string): string {
  const f = migrationFiles().find((name) => name.startsWith(prefix));
  if (!f) throw new Error(`migration ${prefix}_*.sql not found (S3c uses FIXED numbers 0009a/0009)`);
  return readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8').toLowerCase();
}

describe('migration 0009a — postgis extension (guarded), applied BEFORE the geography column', () => {
  // The plan names the prerequisite "0009a". The migrate runner applies files in
  // LEXICAL order, so the file that runs `CREATE EXTENSION postgis` MUST sort no
  // later than the file that declares `geography(Point,4326)` — otherwise the
  // table migration errors with `type "geography" does not exist` (a real trap:
  // "0009a_*.sql" sorts AFTER "0009_*.sql"). We pin the load-bearing invariant —
  // extension-before-geography — not a specific filename, so the implementer is
  // free to name it however sorts correctly (e.g. fold the CREATE EXTENSION into
  // the top of 0009 itself).
  function fileDeclaring(pattern: RegExp): string | undefined {
    return migrationFiles().find((name) =>
      readFileSync(path.join(MIGRATIONS_DIR, name), 'utf8').toLowerCase().match(pattern),
    );
  }

  it('a CREATE EXTENSION IF NOT EXISTS postgis exists somewhere in the chain (idempotent / restore-safe)', () => {
    const f = fileDeclaring(/create\s+extension\s+if\s+not\s+exists\s+postgis/);
    expect(f).toBeDefined();
  });

  it('the extension is created no later than the geography(Point,4326) column (runs first)', () => {
    const extFile = fileDeclaring(/create\s+extension\s+if\s+not\s+exists\s+postgis/)!;
    const geogFile = fileDeclaring(/geography\s*\(\s*point\s*,\s*4326\s*\)/)!;
    expect(extFile).toBeDefined();
    expect(geogFile).toBeDefined();
    // Lexical order = apply order. extFile must be <= geogFile (same file is fine
    // if CREATE EXTENSION precedes the table within it).
    expect(extFile <= geogFile).toBe(true);
  });
});

describe('migration 0009 — visibility + taste_shares shape', () => {
  it('exists with the FIXED 0009 number (not renumbered)', () => {
    const f = migrationFiles().find((name) => name.startsWith('0009_'));
    expect(f).toBeDefined();
  });

  it('adds tastes.visibility (private|shared, default private) with a CHECK', () => {
    const sql = readMigration('0009_');
    expect(sql).toMatch(/alter\s+table\s+tastes\s+add\s+column[\s\S]*visibility/);
    expect(sql).toMatch(/visibility[\s\S]*default\s+'private'/);
    expect(sql).toMatch(/visibility\s+in\s*\(\s*'private'\s*,\s*'shared'\s*\)/);
  });

  it('adds users.default_visibility (private|shared, default private) with a CHECK', () => {
    const sql = readMigration('0009_');
    expect(sql).toMatch(/alter\s+table\s+users\s+add\s+column[\s\S]*default_visibility/);
    expect(sql).toMatch(/default_visibility[\s\S]*default\s+'private'/);
    expect(sql).toMatch(/default_visibility\s+in\s*\(\s*'private'\s*,\s*'shared'\s*\)/);
  });

  it('creates taste_shares with the columns the feeds read', () => {
    const sql = readMigration('0009_');
    expect(sql).toMatch(/create\s+table[\s\S]*taste_shares/);
    for (const col of ['taste_id', 'owner_id', 'target_type', 'target_id', 'geog', 'grid_cell', 'created_at']) {
      expect(sql).toContain(col);
    }
  });

  it('declares geog as a geography(Point,4326) — the PostGIS radius column', () => {
    const sql = readMigration('0009_');
    expect(sql).toMatch(/geog\s+geography\s*\(\s*point\s*,\s*4326\s*\)/);
  });

  it('constrains a geo share to have BOTH geog and grid_cell (no half-written geo row)', () => {
    // The double-write must be enforced at the DB, not just the route: a geo row
    // with a null geog is invisible to ST_DWithin; a null grid_cell has no heat
    // bucket / coarsened position. The partial CHECK exempts non-geo rows.
    const sql = readMigration('0009_');
    expect(sql).toMatch(
      /check\s*\(\s*target_type\s*!=\s*'geo'\s+or\s*\(\s*geog\s+is\s+not\s+null\s+and\s+grid_cell\s+is\s+not\s+null\s*\)\s*\)/,
    );
  });

  it('constrains target_type to geo|family|member', () => {
    const sql = readMigration('0009_');
    expect(sql).toMatch(/target_type\s+in\s*\(\s*'geo'\s*,\s*'family'\s*,\s*'member'\s*\)/);
  });

  it('creates a GiST index on geog scoped to geo shares (radius query support)', () => {
    const sql = readMigration('0009_');
    expect(sql).toMatch(/create\s+index[\s\S]*using\s+gist\s*\(\s*geog\s*\)/);
    // Partial index: only geo rows carry geog.
    expect(sql).toMatch(/using\s+gist\s*\(\s*geog\s*\)\s*where\s+target_type\s*=\s*'geo'/);
  });

  it('creates a grid_cell index (heat aggregation) and a (target_type,target_id) index (family feed)', () => {
    const sql = readMigration('0009_');
    expect(sql).toMatch(/create\s+index[\s\S]*\(\s*grid_cell\s*\)/);
    expect(sql).toMatch(/create\s+index[\s\S]*\(\s*target_type\s*,\s*target_id\s*\)/);
  });
});
