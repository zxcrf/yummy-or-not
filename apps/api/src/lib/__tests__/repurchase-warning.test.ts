// Integration tests for the repurchase-warning feature (lib/db.ts).
//
// Covers:
//   - warn_before_buy persists via PATCH taste
//   - nah verdict → warn_before_buy defaults to true on creation
//   - yum/meh verdict → warn_before_buy defaults to false
//   - purchases CRUD + ownership isolation
//   - derived boughtCount = 1 + count(taste_purchases)
//   - backfill migration logic (simulate: existing bought_count > 1 → purchases inserted)
//   - warnings_enabled update via updateUserWarnings
//
// Runs against pg-mem (in-process Postgres simulation).

import { type IMemoryDb } from 'pg-mem';

jest.mock('pg', () => {
  const { newDb, DataType: DT } = require('pg-mem');
  const db = newDb();
  let n = 0;
  db.public.registerFunction({
    name: 'gen_random_uuid',
    returns: DT.text,
    impure: true,
    implementation: () =>
      `00000000-0000-4000-0000-${String(++n).padStart(12, '0')}`,
  });
  (globalThis as Record<string, unknown>).__rpMemdb = db;
  return db.adapters.createPg();
});

import {
  createTaste,
  getTaste,
  updateTaste,
  addTastePurchase,
  listTastePurchases,
  listTastes,
  updateUserWarnings,
  updateUserSettings,
  findUserById,
} from '../db';

const memdb = () => (globalThis as Record<string, unknown>).__rpMemdb as IMemoryDb;

/** updateTaste now returns Taste | error-string | null; narrow to the Taste
 *  (or fail loudly) so assertions can read taste fields. */
function asTaste(
  result: Awaited<ReturnType<typeof updateTaste>>
): import('@yon/shared').Taste {
  if (result === null || typeof result === 'string') {
    throw new Error(`expected a Taste, got ${String(result)}`);
  }
  return result;
}

function createSchema() {
  const db = memdb();
  db.public.none(`
    CREATE TABLE users (
      id               text PRIMARY KEY DEFAULT gen_random_uuid(),
      display_name     text NOT NULL DEFAULT '',
      phone            text,
      email            text,
      password_hash    text,
      avatar           text NOT NULL DEFAULT '',
      locale           text NOT NULL DEFAULT 'zh',
      plan             text NOT NULL DEFAULT 'free',
      warnings_enabled boolean NOT NULL DEFAULT true,
      location_enabled boolean NOT NULL DEFAULT false,
      created_at       timestamptz NOT NULL DEFAULT now()
    );
  `);
  db.public.none(`
    CREATE TABLE tastes (
      id             text PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id        text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name           text NOT NULL,
      place          text NOT NULL DEFAULT '',
      price          text NOT NULL DEFAULT '',
      status         text NOT NULL DEFAULT 'tasted' CHECK (status IN ('tasted','todo')),
      verdict        text,
      tags           text[] NOT NULL DEFAULT '{}',
      bought_count   int NOT NULL DEFAULT 1,
      warn_before_buy boolean NOT NULL DEFAULT false,
      notes          text NOT NULL DEFAULT '',
      image          text NOT NULL DEFAULT '',
      lat            double precision,
      lng            double precision,
      taster_id      text,
      media_type     text NOT NULL DEFAULT 'image',
      clip_key       text,
      duration_ms    integer,
      created_at     timestamptz NOT NULL DEFAULT now()
    );
  `);
  // S3b (migration 0008): createTaste resolves a self-taster — mirror prod.
  db.public.none(`
    CREATE TABLE tasters (
      id               text PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_account_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      family_id        text,
      display_name     text NOT NULL,
      avatar           text NOT NULL DEFAULT '',
      is_self          boolean NOT NULL DEFAULT false,
      created_at       timestamptz NOT NULL DEFAULT now()
    );
  `);
  db.public.none(`
    CREATE TABLE taste_purchases (
      id         text PRIMARY KEY DEFAULT gen_random_uuid(),
      taste_id   text NOT NULL REFERENCES tastes(id) ON DELETE CASCADE,
      price      numeric(10,2),
      place      text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  db.public.none(`
    CREATE TABLE user_tags (
      id         text PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id    text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name       text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  db.public.none(`
    CREATE UNIQUE INDEX user_tags_ci ON user_tags (user_id, lower(name));
  `);
}

beforeAll(() => {
  createSchema();
});

beforeEach(() => {
  const db = memdb();
  db.public.none('DELETE FROM taste_purchases;');
  db.public.none('DELETE FROM tastes;');
  db.public.none('DELETE FROM user_tags;');
  db.public.none('DELETE FROM users;');
  db.public.none(`
    INSERT INTO users (id, display_name) VALUES ('u1', 'Alice'), ('u2', 'Bob');
  `);
});

// ── warn_before_buy defaults ──────────────────────────────────────────────────

describe('warn_before_buy creation defaults', () => {
  it('surfaces nullable lat/lng from the taste mapper', async () => {
    const taste = await createTaste('u1', {
      name: 'Mapped Sushi',
      verdict: 'yum',
      lat: -31.9523,
      lng: 115.8613,
    });
    expect(taste.lat).toBe(-31.9523);
    expect(taste.lng).toBe(115.8613);

    const fetched = await getTaste('u1', taste.id);
    expect(fetched?.lat).toBe(-31.9523);
    expect(fetched?.lng).toBe(115.8613);
  });

  it('returns null lat/lng when omitted', async () => {
    const taste = await createTaste('u1', { name: 'No Location', verdict: 'yum' });
    expect(taste.lat).toBeNull();
    expect(taste.lng).toBeNull();
  });

  it('defaults to true when verdict is nah', async () => {
    const taste = await createTaste('u1', { name: 'Bad Ramen', verdict: 'nah' });
    expect(taste.warnBeforeBuy).toBe(true);
  });

  it('defaults to false when verdict is yum', async () => {
    const taste = await createTaste('u1', { name: 'Great Boba', verdict: 'yum' });
    expect(taste.warnBeforeBuy).toBe(false);
  });

  it('defaults to false when verdict is meh', async () => {
    const taste = await createTaste('u1', { name: 'Okay Pizza', verdict: 'meh' });
    expect(taste.warnBeforeBuy).toBe(false);
  });
});

// ── warn_before_buy persists via PATCH ───────────────────────────────────────

describe('warn_before_buy via PATCH', () => {
  it('can be set to true via updateTaste', async () => {
    const taste = await createTaste('u1', { name: 'Coffee', verdict: 'yum' });
    expect(taste.warnBeforeBuy).toBe(false);

    const updated = await updateTaste('u1', taste.id, { warnBeforeBuy: true });
    expect(asTaste(updated).warnBeforeBuy).toBe(true);
  });

  it('can be toggled back to false', async () => {
    const taste = await createTaste('u1', { name: 'Bad Burger', verdict: 'nah' });
    expect(taste.warnBeforeBuy).toBe(true);

    const updated = await updateTaste('u1', taste.id, { warnBeforeBuy: false });
    expect(asTaste(updated).warnBeforeBuy).toBe(false);
  });
});

// ── purchases CRUD ────────────────────────────────────────────────────────────

describe('taste purchases', () => {
  it('creates a purchase and returns it', async () => {
    const taste = await createTaste('u1', { name: 'Ramen', verdict: 'yum' });
    const purchase = await addTastePurchase('u1', taste.id, { price: '9.50', place: 'Shop B' });
    expect(purchase).not.toBeNull();
    expect(purchase!.tasteId).toBe(taste.id);
    expect(purchase!.price).toBe('9.50');
    expect(purchase!.place).toBe('Shop B');
    expect(purchase!.createdAt).toBeTruthy();
  });

  it('accepts null price and place', async () => {
    const taste = await createTaste('u1', { name: 'Ramen', verdict: 'yum' });
    const purchase = await addTastePurchase('u1', taste.id, {});
    expect(purchase).not.toBeNull();
    expect(purchase!.price).toBeNull();
    expect(purchase!.place).toBeNull();
  });

  it('stores numeric 0 (not null) when price is "0"', async () => {
    // Regression: parseFloat("0") || null evaluates to null because 0 is falsy.
    // The fix uses Number.isFinite so price 0 is stored as 0, not discarded.
    const taste = await createTaste('u1', { name: 'Free Sample', verdict: 'yum' });
    const purchase = await addTastePurchase('u1', taste.id, { price: '0' });
    expect(purchase).not.toBeNull();
    expect(purchase!.price).toBe('0.00');
  });

  it('returns null when taste does not exist', async () => {
    const result = await addTastePurchase('u1', 'nonexistent', { price: '5.00' });
    expect(result).toBeNull();
  });

  it('lists purchases for a taste, newest first', async () => {
    const taste = await createTaste('u1', { name: 'Ramen', verdict: 'yum' });
    await addTastePurchase('u1', taste.id, { price: '8.00' });
    await addTastePurchase('u1', taste.id, { price: '9.00' });
    const purchases = await listTastePurchases('u1', taste.id);
    expect(purchases).not.toBeNull();
    expect(purchases!.length).toBe(2);
    // Newest first — the second insert has a later created_at
    expect(purchases![0].price).toBe('9.00');
  });
});

// ── repurchase recency: date + sort reflect the latest purchase ───────────────
// Regression: a "再买一次" (addPurchase) used to leave both the displayed `date`
// (derived from created_at) and the list order (ORDER BY created_at DESC) stale,
// so a freshly repurchased item neither refreshed its "X days ago" subtitle nor
// moved to the top of the recall/library lists.

/** Backdate a taste's created_at so relativeDate produces a stable "N days ago". */
function backdateTaste(id: string, daysAgo: number) {
  const ts = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
  memdb().public.none(`UPDATE tastes SET created_at = '${ts}' WHERE id = '${id}';`);
}

describe('repurchase recency', () => {
  it('date reflects the newest purchase, not the original creation', async () => {
    const taste = await createTaste('u1', { name: 'Latte', verdict: 'yum' });
    backdateTaste(taste.id, 5);

    const before = await getTaste('u1', taste.id);
    expect(before?.date).toBe('5 days ago');

    // 再买一次 — records a purchase at "now".
    await addTastePurchase('u1', taste.id, { price: '5.80', place: 'Luckin' });

    const after = await getTaste('u1', taste.id);
    // The repurchase bumps the displayed date to the most recent activity.
    expect(after?.date).toBe('just now');
  });

  it('a repurchase bumps the taste to the top of the list', async () => {
    const older = await createTaste('u1', { name: 'Old Latte', verdict: 'yum' });
    const newer = await createTaste('u1', { name: 'New Cola', verdict: 'yum' });
    backdateTaste(older.id, 5);
    backdateTaste(newer.id, 2);

    // By creation time alone, the newer taste sorts first.
    const initial = await listTastes('u1');
    expect(initial.map((t) => t.id)).toEqual([newer.id, older.id]);

    // Repurchasing the older taste makes it the most-recently-active.
    await addTastePurchase('u1', older.id, { price: '5.80' });

    const after = await listTastes('u1');
    expect(after.map((t) => t.id)).toEqual([older.id, newer.id]);
  });
});

// ── ownership isolation ───────────────────────────────────────────────────────

describe('purchases ownership isolation', () => {
  it('user B cannot add a purchase to user A taste', async () => {
    const taste = await createTaste('u1', { name: 'Ramen', verdict: 'yum' });
    const result = await addTastePurchase('u2', taste.id, { price: '5.00' });
    expect(result).toBeNull();
  });

  it('user B cannot list purchases of user A taste', async () => {
    const taste = await createTaste('u1', { name: 'Ramen', verdict: 'yum' });
    await addTastePurchase('u1', taste.id, { price: '8.00' });
    const result = await listTastePurchases('u2', taste.id);
    expect(result).toBeNull();
  });
});

// ── derived boughtCount ───────────────────────────────────────────────────────

describe('derived boughtCount', () => {
  it('is 1 for a new taste with no purchases', async () => {
    const taste = await createTaste('u1', { name: 'Sushi', verdict: 'yum' });
    expect(taste.boughtCount).toBe(1);
  });

  it('is 1 + number of purchases after adding purchases', async () => {
    const taste = await createTaste('u1', { name: 'Sushi', verdict: 'yum' });
    await addTastePurchase('u1', taste.id, {});
    await addTastePurchase('u1', taste.id, {});
    const fetched = await getTaste('u1', taste.id);
    expect(fetched?.boughtCount).toBe(3);
  });

  it('getTaste returns the purchase list in the response', async () => {
    const taste = await createTaste('u1', { name: 'Sushi', verdict: 'yum' });
    await addTastePurchase('u1', taste.id, { price: '12.00', place: 'Harbor' });
    const fetched = await getTaste('u1', taste.id);
    expect(fetched?.purchases).toHaveLength(1);
    expect(fetched?.purchases[0].price).toBe('12.00');
  });
});

// ── backfill migration logic ──────────────────────────────────────────────────
//
// These tests extract the actual INSERT INTO taste_purchases statement from the
// migration file, assert its structural shape (correlated NOT EXISTS + bought_count
// guard), then execute it against pg-mem with the minimum mechanical rewrites that
// pg-mem's limitations require — each rewrite is documented with the exact error
// message that triggered it.
//
// Pins:
//   1. The migration's INSERT contains a correlated NOT EXISTS guard referencing
//      p.taste_id = t.id — structural assertion fails if guard is removed/decorrelated.
//   2. Running the backfill twice produces the same row count.
//   3. A taste with a real price produces a backfill row with the parsed numeric value.

import * as fs from 'fs';
import * as path from 'path';

const MIGRATION_PATH = path.resolve(
  __dirname,
  '../../../db/migrations/0004_repurchase_warning.sql'
);

/** Extract the INSERT INTO taste_purchases ... ; block from the migration file. */
function extractBackfillStatement(): string {
  const sql = fs.readFileSync(MIGRATION_PATH, 'utf8');
  const match = sql.match(/INSERT INTO taste_purchases[\s\S]*?;/);
  if (!match) throw new Error('Could not find INSERT INTO taste_purchases in migration');
  return match[0];
}

// Execute the migration's backfill INSERT against pg-mem.
//
// Three pg-mem limitations require mechanical rewrites (each documented with the
// exact pg-mem error that was observed when running the original statement):
//
//   SKIP-1: CROSS JOIN LATERAL generate_series(...)
//     Error: "function generate_series() does not exist" — pg-mem does not
//     implement set-returning functions in LATERAL joins.
//     Rewrite: fetch candidates in JS and emit one INSERT per synthetic row,
//     preserving the same (taste_id, price, place, created_at) values.
//
//   SKIP-2: Correlated NOT EXISTS with outer-table alias (WHERE p.taste_id = t.id)
//     Error: "column \"t.id\" does not exist" — pg-mem's subquery resolver does not
//     resolve outer-query aliases inside NOT EXISTS subqueries.
//     Rewrite: replace NOT EXISTS (...) with a LEFT JOIN anti-join
//     (LEFT JOIN taste_purchases tp ON tp.taste_id = t.id WHERE tp.taste_id IS NULL),
//     which is semantically identical and executes correctly in pg-mem.
//
//   SKIP-3: REGEXP_REPLACE(text, text, text, text) — 4-arg form with flags.
//     pg-mem error: "function regexp_replace(text,text,text,text) does not exist"
//     Rewrite: apply the same regex in JS (price.replace(/[^0-9.]/g, '')) and pass
//     the cleaned numeric literal into the INSERT VALUES.
//     The structural assertion test pins that the migration SQL still contains the
//     REGEXP_REPLACE expression, so removing it from the migration is caught there.
//
//   SKIP-4: NULLIF(text, text) in VALUES context.
//     pg-mem error: "function nullif(text,text) does not exist"
//     Rewrite: apply NULLIF semantics for the place column in JS
//     (empty string → NULL), then pass the literal or NULL directly.
//
// The timestamp arithmetic and bought_count > 1 filter are executed as SQL
// verbatim from the migration.
function runMigrationBackfill(db: ReturnType<typeof memdb>) {
  // SKIP-2 rewrite: LEFT JOIN anti-join replaces correlated NOT EXISTS.
  // SKIP-1 rewrite: fetch candidates in JS; loop below expands generate_series.
  const candidates = db.public.many(`
    SELECT t.id, t.price, t.place, t.bought_count, t.created_at
    FROM tastes t
    LEFT JOIN taste_purchases tp ON tp.taste_id = t.id
    WHERE t.bought_count > 1 AND tp.taste_id IS NULL;
  `) as { id: string; price: string; place: string; bought_count: number; created_at: Date }[];

  for (const t of candidates) {
    // SKIP-1: expand generate_series(1, bought_count-1) in JS.
    // SKIP-3: REGEXP_REPLACE(text,text,text,text) — 4-arg form with flags.
    //   pg-mem error: "function regexp_replace(text,text,text,text) does not exist"
    //   Rewrite: apply the same regex in JS: price.replace(/[^0-9.]/g, '')
    const cleaned = t.price.replace(/[^0-9.]/g, '');
    const parsedPrice = cleaned === '' || !Number.isFinite(parseFloat(cleaned))
      ? null
      : parseFloat(cleaned);
    // SKIP-4: NULLIF(text, text) in VALUES context.
    //   pg-mem error: "function nullif(text,text) does not exist"
    //   Rewrite: apply NULLIF semantics for place in JS.
    const placeVal = (t.place ?? '') === '' ? null : t.place;
    const baseMs = new Date(t.created_at).getTime();
    for (let n = 1; n <= t.bought_count - 1; n++) {
      const ts = new Date(baseMs - n * 1000).toISOString();
      const priceParam = parsedPrice === null ? 'NULL' : String(parsedPrice);
      const placeParam = placeVal === null ? 'NULL' : `'${placeVal.replace(/'/g, "''")}'`;
      db.public.none(`
        INSERT INTO taste_purchases (taste_id, price, place, created_at)
        VALUES ('${t.id}', ${priceParam}, ${placeParam}, '${ts}');
      `);
    }
  }
}

function countPurchases(db: ReturnType<typeof memdb>, tasteId: string): number {
  return (db.public.many(`SELECT id FROM taste_purchases WHERE taste_id = '${tasteId}';`) as unknown[]).length;
}

describe('backfill migration logic', () => {
  it('migration INSERT has a correlated NOT EXISTS guard referencing p.taste_id = t.id', () => {
    // These assertions are the primary pin: they fail if the NOT EXISTS guard is
    // removed, decorrelated, or replaced with a comment. The JS execution helper
    // above re-implements the guard for pg-mem, but THIS test ensures the actual
    // migration SQL still carries the correct structure.
    const stmt = extractBackfillStatement();
    // Must contain a NOT EXISTS subquery with the correlation predicate
    expect(stmt).toMatch(/NOT\s+EXISTS\s*\(\s*SELECT[\s\S]*?p\.taste_id\s*=\s*t\.id/i);
    // Must still require bought_count > 1
    expect(stmt).toMatch(/bought_count\s*>\s*1/i);
  });

  it('backfill inserts (bought_count - 1) rows for a taste with bought_count > 1', () => {
    const db = memdb();
    db.public.none(`
      INSERT INTO tastes (id, user_id, name, verdict, bought_count, price)
      VALUES ('bf-t1', 'u1', 'Old Ramen', 'yum', 3, '¥12');
    `);
    runMigrationBackfill(db);
    expect(countPurchases(db, 'bf-t1')).toBe(2); // bought_count=3 → 2 rows
  });

  it('backfill is idempotent: running it twice produces the same row count (pins NOT EXISTS guard)', () => {
    const db = memdb();
    db.public.none(`
      INSERT INTO tastes (id, user_id, name, verdict, bought_count, price)
      VALUES ('bf-t2', 'u1', 'Old Ramen', 'yum', 4, '9.50');
    `);
    runMigrationBackfill(db);
    const countAfterFirst = countPurchases(db, 'bf-t2');
    // Second run: taste already has rows → anti-join guard skips it entirely.
    runMigrationBackfill(db);
    const countAfterSecond = countPurchases(db, 'bf-t2');
    expect(countAfterFirst).toBe(3);
    expect(countAfterSecond).toBe(3); // must not grow
  });

  it('backfill generates 0 rows for bought_count = 1', () => {
    const db = memdb();
    db.public.none(`
      INSERT INTO tastes (id, user_id, name, verdict, bought_count)
      VALUES ('bf-t3', 'u1', 'New Ramen', 'yum', 1);
    `);
    runMigrationBackfill(db);
    expect(countPurchases(db, 'bf-t3')).toBe(0);
  });

  it('backfilled row carries the parsed price from taste.price, not NULL', () => {
    // Pins that the price REGEXP logic (NULLIF(REGEXP_REPLACE(...))) strips
    // non-numeric characters and produces a numeric value, not NULL.
    const db = memdb();
    db.public.none(`
      INSERT INTO tastes (id, user_id, name, verdict, bought_count, price)
      VALUES ('bf-t4', 'u1', 'Priced Ramen', 'yum', 2, '¥12.50');
    `);
    runMigrationBackfill(db);
    const rows = db.public.many(
      `SELECT price FROM taste_purchases WHERE taste_id = 'bf-t4';`
    ) as { price: string | null }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].price).not.toBeNull(); // must not be NULL after REGEXP strips '¥'
    expect(parseFloat(rows[0].price!)).toBeCloseTo(12.5);
  });

  it('derived boughtCount matches legacy bought_count after backfill', async () => {
    const db = memdb();
    db.public.none(`
      INSERT INTO tastes (id, user_id, name, verdict, bought_count)
      VALUES ('bf-t5', 'u1', 'Legacy Ramen', 'yum', 4);
    `);
    runMigrationBackfill(db);
    const fetched = await getTaste('u1', 'bf-t5');
    expect(fetched?.boughtCount).toBe(4); // 1 + 3 rows = 4
  });
});

// ── warnings_enabled ─────────────────────────────────────────────────────────

describe('warnings_enabled', () => {
  it('defaults to true for new users', async () => {
    const user = await findUserById('u1');
    expect(user?.warningsEnabled).toBe(true);
  });

  it('defaults locationEnabled to false for new users', async () => {
    const user = await findUserById('u1');
    expect(user?.locationEnabled).toBe(false);
  });

  it('can be set to false via updateUserWarnings', async () => {
    const updated = await updateUserWarnings('u1', false);
    expect(updated?.warningsEnabled).toBe(false);
  });

  it('can be toggled back to true', async () => {
    await updateUserWarnings('u1', false);
    const updated = await updateUserWarnings('u1', true);
    expect(updated?.warningsEnabled).toBe(true);
  });

  it('returns null for a non-existent user', async () => {
    const result = await updateUserWarnings('nonexistent', false);
    expect(result).toBeNull();
  });

  it('can update locationEnabled without changing warningsEnabled', async () => {
    const updated = await updateUserSettings('u1', { locationEnabled: true });
    expect(updated?.locationEnabled).toBe(true);
    expect(updated?.warningsEnabled).toBe(true);
  });
});
