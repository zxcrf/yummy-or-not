// Idempotent forward-only migration runner.
// Reads migrations from db/migrations/*.sql in lexical order, records applied
// files in a `_migrations` table, and skips already-applied files on re-run.
// Safe to run multiple times against the same DB — no destructive operations.
// Does NOT touch db/schema.sql or db:setup (those remain separate).
//
// Usage: node scripts/migrate.mjs
//        pnpm --filter api db:migrate
import { readFileSync, readdirSync } from 'fs';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

// Parse .env manually — simple KEY=VALUE, ignore comments and blanks.
function loadDotEnv(envPath) {
  try {
    const text = readFileSync(envPath, 'utf8');
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      if (!(key in process.env)) process.env[key] = val;
    }
  } catch {
    // .env not found — rely on environment already having DATABASE_URL
  }
}

loadDotEnv(path.join(root, '.env'));

const { DATABASE_URL } = process.env;
if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL is not set.');
  process.exit(1);
}

const require = createRequire(import.meta.url);
const { Pool } = require('pg');

const pool = new Pool({ connectionString: DATABASE_URL });

async function run() {
  const client = await pool.connect();
  try {
    // Ensure the migrations tracking table exists.
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        filename   text        PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    // Collect applied migrations.
    const { rows: applied } = await client.query(
      'SELECT filename FROM _migrations ORDER BY filename'
    );
    const appliedSet = new Set(applied.map((r) => r.filename));

    // Collect migration files in lexical order.
    const migrationsDir = path.join(root, 'db', 'migrations');
    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    let ran = 0;
    for (const file of files) {
      if (appliedSet.has(file)) {
        console.log(`  skip  ${file} (already applied)`);
        continue;
      }

      const sql = readFileSync(path.join(migrationsDir, file), 'utf8');

      console.log(`  apply ${file} …`);
      // Run the migration + record it atomically.
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO _migrations (filename) VALUES ($1)',
          [file]
        );
        await client.query('COMMIT');
        console.log(`  done  ${file}`);
        ran++;
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`  FAILED ${file}:`, err.message);
        throw err;
      }
    }

    if (ran === 0) {
      console.log('All migrations already applied — nothing to do.');
    } else {
      console.log(`\nApplied ${ran} migration(s).`);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error('db:migrate failed:', err.message);
  process.exit(1);
});
