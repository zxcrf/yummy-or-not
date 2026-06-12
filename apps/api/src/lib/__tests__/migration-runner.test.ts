// DB-level migration runner test — proves the BLOCKER fix works.
//
// Runs against a real throwaway Postgres when TEST_DATABASE_URL is set;
// skips cleanly when it is absent (CI without postgres, local dev).
//
// What it validates:
//   1. Starting from a prod-shaped baseline (0001-0005 effects present,
//      no _migrations table), the runner applies only 0006 without error —
//      which was impossible before the 0005 idempotency fix.
//   2. tastes.status column exists after the run.
//   3. All 6 migration filenames are recorded in _migrations.
//   4. A second run is a no-op (runner idempotency via _migrations tracking).
//
// To run locally:
//   TEST_DATABASE_URL=postgres://... pnpm --filter api test -- --testPathPattern=migration-runner

import path from 'path';
import { readFileSync, readdirSync } from 'fs';
import { execFileSync } from 'child_process';

const TEST_DB = process.env.TEST_DATABASE_URL;
const d = TEST_DB ? describe : describe.skip;

const ROOT = path.resolve(__dirname, '../../../');
const MIGRATIONS_DIR = path.join(ROOT, 'db', 'migrations');
const MIGRATE_SCRIPT = path.join(ROOT, 'scripts', 'migrate.mjs');

// ── helpers ───────────────────────────────────────────────────────────────────

/** Run a SQL string against the test DB via a fresh pg.Client. */
async function sql(
  query: string,
  params: unknown[] = [],
): Promise<{ rows: Record<string, unknown>[] }> {
  const { Client } = await import('pg');
  const client = new Client({ connectionString: TEST_DB });
  await client.connect();
  try {
    return await client.query(query, params as never[]);
  } finally {
    await client.end();
  }
}

/** Run migrate.mjs against the test DB. */
function runMigrator(): void {
  execFileSync(process.execPath, [MIGRATE_SCRIPT], {
    env: { ...process.env, DATABASE_URL: TEST_DB },
    stdio: 'pipe',
  });
}

/** Return true when the column exists in information_schema. */
async function columnExists(table: string, column: string): Promise<boolean> {
  const { rows } = await sql(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
    [table, column],
  );
  return rows.length > 0;
}

/** Return all filenames recorded in _migrations, sorted. */
async function appliedMigrations(): Promise<string[]> {
  const { rows } = await sql('SELECT filename FROM _migrations ORDER BY filename');
  return rows.map((r) => r['filename'] as string);
}

// ── prod-shaped baseline ──────────────────────────────────────────────────────
// schema.sql has DROP TABLE IF EXISTS ... at the top, so it is re-entrant.
// After applying it we drop the status column to reproduce the pre-0006 prod
// state: all tables/columns through 0005 exist, status is absent, no runner
// tracking table.

async function buildProdBaseline(): Promise<void> {
  const schema = readFileSync(path.join(ROOT, 'db', 'schema.sql'), 'utf8');
  await sql(schema);
  // Remove status column — this is the prod state that caused save-500.
  await sql('ALTER TABLE tastes DROP COLUMN IF EXISTS status');
  // DROP COLUMN already removes dependent objects (the index), but be explicit.
  await sql('DROP INDEX IF EXISTS tastes_user_status_created_idx');
  // Ensure no _migrations table exists — first-ever runner run.
  await sql('DROP TABLE IF EXISTS _migrations');
}

// ── tests ─────────────────────────────────────────────────────────────────────

d('migration runner — prod-shaped baseline (no _migrations, no status column)', () => {
  beforeEach(async () => {
    await buildProdBaseline();
  }, 30_000);

  it('tastes.status is absent before the run (baseline sanity check)', async () => {
    expect(await columnExists('tastes', 'status')).toBe(false);
  });

  it('runner applies 0006 and tastes.status exists afterward', async () => {
    runMigrator();
    expect(await columnExists('tastes', 'status')).toBe(true);
  });

  it('all 6 migration filenames are recorded in _migrations after a full run', async () => {
    runMigrator();
    const applied = await appliedMigrations();
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
    expect(applied).toEqual(files);
  });

  it('re-running the runner is a no-op (idempotent)', async () => {
    runMigrator();
    runMigrator(); // second run must not throw and must not duplicate rows
    const applied = await appliedMigrations();
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
    expect(applied).toEqual(files); // still exactly 6, no duplicates
    expect(await columnExists('tastes', 'status')).toBe(true);
  });

  it('runner skips 0001-0005 when pre-recorded, applies only 0006', async () => {
    // Exact prod scenario: 0001-0005 were applied manually long ago (no
    // _migrations rows existed then). Now the runner runs for the first time.
    await sql(`
      CREATE TABLE IF NOT EXISTS _migrations (
        filename   text        PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
    for (const f of files.filter((f) => f < '0006')) {
      await sql('INSERT INTO _migrations (filename) VALUES ($1)', [f]);
    }
    // status still absent in this baseline.
    expect(await columnExists('tastes', 'status')).toBe(false);

    runMigrator(); // must apply only 0006, not re-run 0001-0005

    expect(await columnExists('tastes', 'status')).toBe(true);
    const applied = await appliedMigrations();
    expect(applied).toEqual(files);
  });
});
