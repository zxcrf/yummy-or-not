// DB-level test for migration 0007 — the S3a thin-pointer share schema.
//
// Runs against a real throwaway Postgres when TEST_DATABASE_URL is set; skips
// cleanly when it is absent (CI without postgres / local dev). Mirrors the
// migration-runner.test.ts pattern.
//
// Pins the locked design (docs/product/plans/share-and-circles.md §S3a):
//   - share_tokens exists with token PK, taste_id, owner_id, revoked, expires_at
//   - share_tokens has NO jsonb snapshot column and NO photo_key copy column
//     (thin pointer only — the review翻修 explicitly removed these)
//   - taste_imports exists with provenance + UNIQUE(from_token, importer_id)
//   - the 0007 file is present and recorded by the runner
//
// To run locally:
//   TEST_DATABASE_URL=postgres://... pnpm --filter api test -- --testPathPattern=share-migration-0007

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

async function columns(table: string): Promise<Set<string>> {
  const { rows } = await sql(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1`,
    [table],
  );
  return new Set(rows.map((r) => r['column_name'] as string));
}

async function tableExists(table: string): Promise<boolean> {
  const { rows } = await sql(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = $1`,
    [table],
  );
  return rows.length > 0;
}

async function buildBaseline(): Promise<void> {
  const schema = readFileSync(path.join(ROOT, 'db', 'schema.sql'), 'utf8');
  await sql(schema);
  // schema.sql is the CURRENT consolidated state (0001-0006 effects present), so
  // re-applying the additive migrations 0001-0006 over it must be a no-op. The
  // only non-idempotent step is 0006's `ADD CONSTRAINT tastes_status_verdict_check`
  // — reset it exactly like migration-runner.test.ts's buildProdBaseline by
  // dropping the status column (DROP COLUMN cascades the dependent CHECK), so the
  // runner re-adds it cleanly on the way to applying 0007. This mirrors the
  // referenced pattern and changes no assertion below.
  await sql('ALTER TABLE tastes DROP COLUMN IF EXISTS status');
  await sql('DROP INDEX IF EXISTS tastes_user_status_created_idx');
  await sql('DROP TABLE IF EXISTS taste_imports');
  await sql('DROP TABLE IF EXISTS share_tokens');
  await sql('DROP TABLE IF EXISTS _migrations');
}

d('migration 0007 — share_tokens / taste_imports thin-pointer schema', () => {
  beforeEach(async () => {
    await buildBaseline();
    runMigrator();
  }, 30_000);

  it('0007 file exists and is recorded by the runner', async () => {
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));
    expect(files.some((f) => f.startsWith('0007'))).toBe(true);
    const { rows } = await sql('SELECT filename FROM _migrations');
    expect(rows.map((r) => r['filename']).some((f) => String(f).startsWith('0007'))).toBe(true);
  });

  it('share_tokens has the thin-pointer columns (token PK, taste_id, owner_id, revoked, expires_at)', async () => {
    expect(await tableExists('share_tokens')).toBe(true);
    const cols = await columns('share_tokens');
    for (const c of ['token', 'taste_id', 'owner_id', 'revoked', 'expires_at', 'created_at']) {
      expect(cols.has(c)).toBe(true);
    }
  });

  it('share_tokens has an import_code column + index so resolve is O(1) (not a full scan)', async () => {
    // The review翻修 stores the derived import code so GET /api/share/resolve is
    // an indexed lookup instead of scanning ALL live tokens and re-hashing each.
    const cols = await columns('share_tokens');
    expect(cols.has('import_code')).toBe(true);

    // An index on import_code must exist (partial index on live tokens is fine).
    const { rows } = await sql(
      `SELECT indexdef FROM pg_indexes
       WHERE schemaname='public' AND tablename='share_tokens'`,
    );
    const defs = rows.map((r) => String(r['indexdef']));
    expect(defs.some((d) => /\(import_code\)/.test(d))).toBe(true);
  });

  it('an indexed resolve query (WHERE import_code = $1) returns the live token', async () => {
    // Prove the stored code is queryable directly — the shape resolveImportCode
    // now uses. A revoked token with the same code must NOT match.
    await sql(`INSERT INTO users (id) VALUES ('u-own2') ON CONFLICT DO NOTHING`);
    await sql(
      `INSERT INTO tastes (id, user_id, name, status, verdict)
       VALUES ('t-src2','u-own2','x','tasted','yum') ON CONFLICT DO NOTHING`,
    );
    await sql(
      `INSERT INTO share_tokens (token, taste_id, owner_id, import_code, revoked)
       VALUES ('tk-live','t-src2','u-own2','ABC123', false),
              ('tk-dead','t-src2','u-own2','ABC123', true)`,
    );
    const { rows } = await sql(
      `SELECT token FROM share_tokens
        WHERE import_code = $1 AND revoked = false
          AND (expires_at IS NULL OR expires_at > now()) LIMIT 1`,
      ['ABC123'],
    );
    expect(rows.length).toBe(1);
    expect(rows[0]['token']).toBe('tk-live');
  });

  it('share_tokens has NO jsonb snapshot column and NO photo_key copy column (thin pointer only)', async () => {
    const cols = await columns('share_tokens');
    // The review翻修 removed any per-share snapshot / photo copy storage.
    expect(cols.has('snapshot')).toBe(false);
    expect(cols.has('taste_json')).toBe(false);
    expect(cols.has('photo_key')).toBe(false);
    // No jsonb column at all on share_tokens.
    const { rows } = await sql(
      `SELECT data_type FROM information_schema.columns
       WHERE table_schema='public' AND table_name='share_tokens'`,
    );
    expect(rows.map((r) => r['data_type'])).not.toContain('jsonb');
  });

  it('taste_imports has provenance columns + UNIQUE(from_token, importer_id)', async () => {
    expect(await tableExists('taste_imports')).toBe(true);
    const cols = await columns('taste_imports');
    for (const c of ['id', 'taste_id', 'from_token', 'from_user_id', 'importer_id', 'created_at']) {
      expect(cols.has(c)).toBe(true);
    }
    // UNIQUE(from_token, importer_id) — the idempotency guard.
    const { rows } = await sql(`
      SELECT 1
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      WHERE t.relname = 'taste_imports'
        AND c.contype = 'u'
        AND (
          SELECT array_agg(a.attname ORDER BY a.attname)
          FROM unnest(c.conkey) k(attnum)
          JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
        ) = ARRAY['from_token','importer_id']::name[]
    `);
    expect(rows.length).toBe(1);
  });

  it('the UNIQUE actually rejects a duplicate (importer, token) pair', async () => {
    // Seed a user + taste so FKs are satisfiable, then prove the constraint bites.
    await sql(`INSERT INTO users (id) VALUES ('u-imp') ON CONFLICT DO NOTHING`);
    await sql(`INSERT INTO users (id) VALUES ('u-own') ON CONFLICT DO NOTHING`);
    await sql(
      `INSERT INTO tastes (id, user_id, name, status, verdict)
       VALUES ('t-src','u-own','x','tasted','yum') ON CONFLICT DO NOTHING`,
    );
    await sql(
      `INSERT INTO share_tokens (token, taste_id, owner_id)
       VALUES ('tk1','t-src','u-own')`,
    );
    await sql(
      `INSERT INTO tastes (id, user_id, name, status)
       VALUES ('t-copy','u-imp','x','todo') ON CONFLICT DO NOTHING`,
    );
    await sql(
      `INSERT INTO taste_imports (taste_id, from_token, importer_id)
       VALUES ('t-copy','tk1','u-imp')`,
    );
    await expect(
      sql(
        `INSERT INTO taste_imports (taste_id, from_token, importer_id)
         VALUES ('t-copy','tk1','u-imp')`,
      ),
    ).rejects.toThrow();
  });
});
