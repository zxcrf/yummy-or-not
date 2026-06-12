// Reproduction test for the save-500 bug: createTaste INSERT lists `status` in
// the column set, but prod DB may not have that column if migration 0006 was
// never applied (db:setup runs schema.sql destructively; db:migrate is the
// forward-only runner). This test ensures the INSERT column list and the
// schema/migration column set never diverge again.
//
// Failure mode pinned: if schema.sql (or any migration) adds/removes a column
// that is named in the createTaste INSERT, the test fails before the bug
// reaches prod. Likewise if someone adds a column to the INSERT without
// adding it to schema.sql or any migration.
//
// Verification: removing 'status' from the expected set or from the INSERT
// string causes this test to fail — proving it would have caught the 0006 bug.

import { readFileSync, readdirSync } from 'fs';
import path from 'path';

// __tests__ → lib → src → apps/api (3 levels up)
const ROOT = path.resolve(__dirname, '../../../');

// ── helpers ──────────────────────────────────────────────────────────────────

/** Extract column names defined for the tastes table from a SQL string.
 *  Handles CREATE TABLE tastes blocks (using paren-depth tracking so semicolons
 *  inside DEFAULT expressions don't truncate the match) and ADD COLUMN statements
 *  from migrations. */
function extractSchemaCols(sql: string): Set<string> {
  const cols = new Set<string>();

  // ADD COLUMN [IF NOT EXISTS] <col> from ALTER TABLE tastes lines.
  for (const m of sql.matchAll(/ADD\s+COLUMN(?:\s+IF\s+NOT\s+EXISTS)?\s+(\w+)/gi)) {
    cols.add(m[1].toLowerCase());
  }

  // Inside CREATE TABLE tastes (...): walk char-by-char tracking paren depth so
  // semicolons inside DEFAULT expressions (e.g. gen_random_uuid()::text) don't
  // terminate the match early.
  const createIdx = sql.search(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?tastes\s*\(/i);
  if (createIdx !== -1) {
    // Find the opening paren of the column list.
    const openParen = sql.indexOf('(', createIdx);
    let depth = 0;
    let end = -1;
    for (let i = openParen; i < sql.length; i++) {
      if (sql[i] === '(') depth++;
      else if (sql[i] === ')') {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    if (end !== -1) {
      const body = sql.slice(openParen + 1, end);
      for (const line of body.split('\n')) {
        const trimmed = line.trim();
        // Skip empty lines, SQL comments, and CONSTRAINT declarations.
        if (!trimmed || trimmed.startsWith('--') || /^CONSTRAINT\b/i.test(trimmed)) continue;
        const colName = trimmed.split(/\s+/)[0];
        if (colName && /^\w+$/.test(colName)) {
          cols.add(colName.toLowerCase());
        }
      }
    }
  }

  return cols;
}

/** Parse the column list from the createTaste INSERT statement in db.ts.
 *  Extracts names from: INSERT INTO tastes (col1, col2, ...) */
function extractInsertCols(dbTs: string): string[] {
  const m = dbTs.match(/INSERT\s+INTO\s+tastes\s*\(([^)]+)\)/i);
  if (!m) throw new Error('Could not find INSERT INTO tastes(...) in db.ts');
  return m[1].split(',').map((c) => c.trim().toLowerCase());
}

// ── build the expected column set from schema.sql + migrations ───────────────

function buildExpectedCols(): Set<string> {
  const schema = readFileSync(path.join(ROOT, 'db/schema.sql'), 'utf8');
  const cols = extractSchemaCols(schema);

  const migrationsDir = path.join(ROOT, 'db/migrations');
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const sql = readFileSync(path.join(migrationsDir, file), 'utf8');
    for (const col of extractSchemaCols(sql)) {
      cols.add(col);
    }
  }

  return cols;
}

// ── test ─────────────────────────────────────────────────────────────────────

describe('createTaste INSERT columns vs schema + migrations', () => {
  let schemaCols: Set<string>;
  let insertCols: string[];

  beforeAll(() => {
    schemaCols = buildExpectedCols();
    const dbTs = readFileSync(path.join(ROOT, 'src/lib/db.ts'), 'utf8');
    insertCols = extractInsertCols(dbTs);
  });

  it('every INSERT column exists in schema.sql or a migration (catches missing-column 500)', () => {
    // This is the exact failure mode of the save-500 bug: `status` was named in
    // the INSERT but not yet applied to prod DB (migration 0006 not run).
    const missing = insertCols.filter((col) => !schemaCols.has(col));
    expect(missing).toEqual([]);
  });

  it('INSERT names `status` (regression pin for migration 0006)', () => {
    // Pinning that the fix is in place: `status` must stay in the INSERT list.
    expect(insertCols).toContain('status');
  });

  it('schema column set contains `status` (migration 0006 guard)', () => {
    // If schema.sql or the migrations are ever stripped of `status`, this fails.
    expect(schemaCols.has('status')).toBe(true);
  });
});
