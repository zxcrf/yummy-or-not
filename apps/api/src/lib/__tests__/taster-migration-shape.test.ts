// Static migration-shape guard for S3b (migration 0008), mirroring the spirit of
// schema-column-drift.test.ts: pin that the on-disk migration + schema actually
// declare every structure the S3b DB helpers and routes rely on, so a missing
// column can't reach prod as a save-500 the way the 0006 `status` gap did.
//
// What it pins (from docs/product/plans/share-and-circles.md §S3b):
//   - migration 0008 exists with the FIXED number (0008_*), not renumbered.
//   - It creates the `families` and `tasters` tables.
//   - `tasters` has owner_account_id, family_id, display_name, avatar, is_self.
//   - It adds tastes.taster_id and an index on it.
//   - It adds users.media_enabled (the S3b-media capability flag) — and does NOT
//     widen the plan enum (no new plan value / CHECK rewrite).
//
// FAILS today: db/migrations/0008_*.sql does not exist. PASSES once the
// migration ships with the FIXED 0008 number.

import { readFileSync, readdirSync } from 'fs';
import path from 'path';

// __tests__ → lib → src → apps/api
const ROOT = path.resolve(__dirname, '../../../');
const MIGRATIONS_DIR = path.join(ROOT, 'db', 'migrations');

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
}

/** Read the single 0008_*.sql migration body (lower-cased for matching). */
function read0008(): string {
  const f = migrationFiles().find((name) => name.startsWith('0008'));
  if (!f) throw new Error('migration 0008_*.sql not found (S3b uses the FIXED number 0008)');
  return readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8').toLowerCase();
}

describe('migration 0008 — taster / family shape', () => {
  it('exists with the FIXED 0008 number (not renumbered)', () => {
    const f = migrationFiles().find((name) => name.startsWith('0008'));
    expect(f).toBeDefined();
  });

  it('creates the families and tasters tables', () => {
    const sql = read0008();
    expect(sql).toMatch(/create\s+table[\s\S]*families/);
    expect(sql).toMatch(/create\s+table[\s\S]*tasters/);
  });

  it('declares the tasters columns the helpers read', () => {
    const sql = read0008();
    for (const col of ['owner_account_id', 'family_id', 'display_name', 'avatar', 'is_self']) {
      expect(sql).toContain(col);
    }
  });

  it('adds tastes.taster_id with an index', () => {
    const sql = read0008();
    expect(sql).toMatch(/alter\s+table\s+tastes\s+add\s+column[\s\S]*taster_id/);
    expect(sql).toMatch(/create\s+index[\s\S]*taster_id/);
  });

  it('adds users.media_enabled as a boolean default false — without touching the plan enum', () => {
    const sql = read0008();
    expect(sql).toMatch(/alter\s+table\s+users\s+add\s+column[\s\S]*media_enabled/);
    expect(sql).toMatch(/media_enabled[\s\S]*boolean/);
    // S3b must NOT extend the plan enum: capability lives on its own flag.
    expect(sql).not.toMatch(/plan\s+in\s*\(/);
  });
});
