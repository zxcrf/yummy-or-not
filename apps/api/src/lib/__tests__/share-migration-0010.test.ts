// DB-level test for migration 0010 — UNIQUE partial index on import_code.
//
// Runs against a real throwaway Postgres when TEST_DATABASE_URL is set; skips
// cleanly when it is absent (CI without postgres / local dev). Mirrors the
// share-migration-0007.test.ts pattern.
//
// Pins the security fix: the 0010 migration replaces the non-unique partial
// index on share_tokens.import_code with a UNIQUE partial index so that two
// live (non-revoked) tokens cannot carry the same import code. resolveImportCode
// LIMIT 1 is then guaranteed to match at most one live token.
//
// To run locally:
//   TEST_DATABASE_URL=postgres://... pnpm --filter api test -- --testPathPattern=share-migration-0010

import path from 'path';
import { readFileSync, readdirSync } from 'fs';
import { execFileSync } from 'child_process';

const TEST_DB = process.env.TEST_DATABASE_URL;
const d = TEST_DB ? describe : describe.skip;

const ROOT = path.resolve(__dirname, '../../../');
const MIGRATIONS_DIR = path.join(ROOT, 'db', 'migrations');
const MIGRATE_SCRIPT = path.join(ROOT, 'scripts', 'migrate.mjs');

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

function runMigrator(): void {
  execFileSync(process.execPath, [MIGRATE_SCRIPT], {
    env: { ...process.env, DATABASE_URL: TEST_DB },
    stdio: 'pipe',
  });
}

async function buildBaseline(): Promise<void> {
  const schema = readFileSync(path.join(ROOT, 'db', 'schema.sql'), 'utf8');
  await sql(schema);
  // Reset additive columns that schema.sql already includes so the migrator
  // can re-apply them cleanly (mirrors the 0007 test baseline pattern).
  await sql('ALTER TABLE tastes DROP COLUMN IF EXISTS status');
  await sql('DROP INDEX IF EXISTS tastes_user_status_created_idx');
  await sql('DROP TABLE IF EXISTS taste_imports');
  await sql('DROP TABLE IF EXISTS share_tokens');
  await sql('DROP TABLE IF EXISTS _migrations');
}

d('migration 0010 — UNIQUE partial index on share_tokens.import_code', () => {
  beforeEach(async () => {
    await buildBaseline();
    runMigrator();
  }, 30_000);

  it('0010 file exists and is recorded by the runner', async () => {
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));
    expect(files.some((f) => f.startsWith('0010'))).toBe(true);
    const { rows } = await sql('SELECT filename FROM _migrations');
    expect(rows.map((r) => r['filename']).some((f) => String(f).startsWith('0010'))).toBe(true);
  });

  it('share_tokens_import_code_unique_idx exists and is UNIQUE + partial (WHERE revoked=false)', async () => {
    const { rows } = await sql(
      `SELECT indexdef FROM pg_indexes
       WHERE schemaname='public' AND tablename='share_tokens'`,
    );
    const defs = rows.map((r) => String(r['indexdef']));

    // A UNIQUE index on import_code must exist.
    const uniqueIdx = defs.find((d) => /UNIQUE/.test(d) && /\(import_code\)/.test(d));
    expect(uniqueIdx).toBeDefined();

    // It must be partial (WHERE revoked = false) — so revoked tokens don't block
    // re-use of a code by a later mint.
    expect(uniqueIdx).toMatch(/WHERE\s+revoked\s*=\s*false/i);

    // The old non-unique index must be gone.
    const nonUniqueOld = defs.find(
      (d) => !/UNIQUE/.test(d) && /share_tokens_import_code_idx/.test(d),
    );
    expect(nonUniqueOld).toBeUndefined();
  });

  it('UNIQUE constraint prevents two live tokens sharing the same import_code', async () => {
    await sql(`INSERT INTO users (id) VALUES ('u-col1') ON CONFLICT DO NOTHING`);
    await sql(
      `INSERT INTO tastes (id, user_id, name, status, verdict)
       VALUES ('t-col1','u-col1','x','tasted','yum') ON CONFLICT DO NOTHING`,
    );
    await sql(
      `INSERT INTO share_tokens (token, taste_id, owner_id, import_code, revoked)
       VALUES ('tk-a','t-col1','u-col1','ABCDE12345', false)`,
    );
    // A second live token with the same import_code must be rejected.
    await expect(
      sql(
        `INSERT INTO share_tokens (token, taste_id, owner_id, import_code, revoked)
         VALUES ('tk-b','t-col1','u-col1','ABCDE12345', false)`,
      ),
    ).rejects.toThrow();
  });

  it('a REVOKED token with the same import_code does not block a new live token', async () => {
    await sql(`INSERT INTO users (id) VALUES ('u-col2') ON CONFLICT DO NOTHING`);
    await sql(
      `INSERT INTO tastes (id, user_id, name, status, verdict)
       VALUES ('t-col2','u-col2','x','tasted','yum') ON CONFLICT DO NOTHING`,
    );
    // A revoked token holds the code — the partial index excludes it.
    await sql(
      `INSERT INTO share_tokens (token, taste_id, owner_id, import_code, revoked)
       VALUES ('tk-dead','t-col2','u-col2','ZYXWV98765', true)`,
    );
    // A new live token with the same code must succeed (revoked row is outside the index).
    await expect(
      sql(
        `INSERT INTO share_tokens (token, taste_id, owner_id, import_code, revoked)
         VALUES ('tk-live','t-col2','u-col2','ZYXWV98765', false)`,
      ),
    ).resolves.toBeDefined();
  });
});

// ── Static shape test (no DB required) ────────────────────────────────────────
// Verifies the migration file text creates a UNIQUE index and drops the old one.

describe('migration 0010 file — static shape', () => {
  const migrationPath = path.join(
    __dirname,
    '../../../db/migrations/0010_share_import_code_unique.sql',
  );

  it('file exists', () => {
    expect(() => readFileSync(migrationPath, 'utf8')).not.toThrow();
  });

  it('creates a UNIQUE index on import_code WHERE revoked = false', () => {
    const text = readFileSync(migrationPath, 'utf8');
    expect(text).toMatch(/CREATE UNIQUE INDEX/i);
    expect(text).toMatch(/\(import_code\)/);
    expect(text).toMatch(/WHERE\s+revoked\s*=\s*false/i);
  });

  it('drops the old non-unique index idempotently (IF EXISTS)', () => {
    const text = readFileSync(migrationPath, 'utf8');
    expect(text).toMatch(/DROP INDEX IF EXISTS share_tokens_import_code_idx/i);
  });
});
