// Integration tests for S3b taster/family — migration 0008 + DB helpers.
//
// Runs against pg-mem (in-process Postgres), mirroring status.test.ts.
//
// Pins the design's load-bearing migration guarantee (§S3b verification:
// "迁移回填 self-taster 不丢历史 tastes"):
//
//   - backfillSelfTasters(): for EVERY existing user, creates exactly one
//     is_self=true taster and points all of that user's existing tastes at it.
//     Historical tastes are NOT lost — same row count, same ids, names, verdicts.
//   - A user's tastes never get assigned to ANOTHER user's self-taster.
//   - ensureSelfTaster() is idempotent: re-running creates no duplicate self row.
//   - createTaste with an explicit taster_id stamps that taster on the new row.
//   - createTaste without a taster_id falls back to the caller's self-taster.
//   - listTastes({ taster }) filters to just that taster's rows.
//
// These FAIL today: the tasters/families tables, the tastes.taster_id column,
// and the helpers (backfillSelfTasters / ensureSelfTaster / taster-aware
// createTaste + listTastes) do not exist yet. They PASS once migration 0008 +
// the DB helpers ship.

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
      `00000000-0000-4000-9000-${String(++n).padStart(12, '0')}`,
  });
  (globalThis as Record<string, unknown>).__tasterMemdb = db;
  return db.adapters.createPg();
});

import {
  createTaste,
  listTastes,
  // S3b helpers — do not exist yet (RED).
  backfillSelfTasters,
  ensureSelfTaster,
} from '@/lib/db';

const memdb = () => (globalThis as Record<string, unknown>).__tasterMemdb as IMemoryDb;

function createSchema() {
  const db = memdb();
  // users + tastes mirror the existing prod shape (status.test.ts), MINUS the
  // taster_id column, so the migration-style backfill can add it.
  db.public.none(`
    CREATE TABLE users (
      id               text PRIMARY KEY DEFAULT gen_random_uuid(),
      display_name     text NOT NULL DEFAULT '',
      plan             text NOT NULL DEFAULT 'free',
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
      created_at     timestamptz NOT NULL DEFAULT now()
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
  // S3b migration 0008 — families + tasters + tastes.taster_id.
  db.public.none(`
    CREATE TABLE families (
      id         text PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_id   text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name       text NOT NULL DEFAULT '',
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  db.public.none(`
    CREATE TABLE tasters (
      id               text PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_account_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      family_id        text REFERENCES families(id) ON DELETE SET NULL,
      display_name     text NOT NULL,
      avatar           text NOT NULL DEFAULT '',
      is_self          boolean NOT NULL DEFAULT false,
      created_at       timestamptz NOT NULL DEFAULT now()
    );
  `);
  db.public.none(`
    ALTER TABLE tastes ADD COLUMN taster_id text REFERENCES tasters(id) ON DELETE SET NULL;
  `);
}

// Migration 0008's partial unique index (one is_self taster per owner). It is
// created/dropped per-test only where the race guard is under test: pg-mem has a
// planner bug where a partial unique index on `owner_account_id` is wrongly used
// as the arbiter for ANY owner_account_id equality lookup, dropping rows whose
// is_self=false (real Postgres only uses a partial index when the query implies
// its predicate). Production DDL is correct (apps/api/db/schema.sql + migration
// 0008); we scope the index to the race-guard tests so it can't poison the
// ordinary getTaster/listTastes lookups the other tests exercise.
const SELF_INDEX_DDL =
  'CREATE UNIQUE INDEX tasters_one_self_per_owner ON tasters (owner_account_id) WHERE is_self';
function withSelfIndex() {
  memdb().public.none(SELF_INDEX_DDL);
}
function dropSelfIndex() {
  memdb().public.none('DROP INDEX IF EXISTS tasters_one_self_per_owner');
}

beforeAll(() => {
  createSchema();
});

beforeEach(() => {
  const db = memdb();
  db.public.none('DELETE FROM taste_purchases;');
  db.public.none('DELETE FROM tastes;');
  db.public.none('DELETE FROM tasters;');
  db.public.none('DELETE FROM families;');
  db.public.none('DELETE FROM users;');
});

/** Count helper. */
function count(sql: string): number {
  const rows = memdb().public.many(sql) as Array<Record<string, unknown>>;
  return Number((rows[0] as { n: unknown }).n);
}

describe('backfillSelfTasters — migration 0008 backfill', () => {
  it('creates exactly one is_self taster per existing user and loses no historical tastes', async () => {
    const db = memdb();
    // Two pre-existing users, each with historical tastes (no taster_id yet).
    db.public.none(`INSERT INTO users (id, display_name) VALUES ('u1','Alice'),('u2','Bob');`);
    db.public.none(`
      INSERT INTO tastes (id, user_id, name, verdict) VALUES
        ('t1','u1','Alice Ramen','yum'),
        ('t2','u1','Alice Boba','meh'),
        ('t3','u2','Bob Pizza','nah');
    `);
    const beforeRows = count(`SELECT COUNT(*)::int AS n FROM tastes`);
    expect(beforeRows).toBe(3);

    await backfillSelfTasters();

    // Exactly one is_self taster per user.
    expect(count(`SELECT COUNT(*)::int AS n FROM tasters WHERE is_self = true`)).toBe(2);
    expect(count(`SELECT COUNT(*)::int AS n FROM tasters WHERE owner_account_id = 'u1' AND is_self = true`)).toBe(1);
    expect(count(`SELECT COUNT(*)::int AS n FROM tasters WHERE owner_account_id = 'u2' AND is_self = true`)).toBe(1);

    // No historical taste was dropped, and none is left unassigned.
    expect(count(`SELECT COUNT(*)::int AS n FROM tastes`)).toBe(3);
    expect(count(`SELECT COUNT(*)::int AS n FROM tastes WHERE taster_id IS NULL`)).toBe(0);

    // Each user's tastes point at THAT user's self-taster — never a cross-owner leak.
    const u1self = (memdb().public.one(
      `SELECT id FROM tasters WHERE owner_account_id = 'u1' AND is_self = true`,
    ) as { id: string }).id;
    const u2self = (memdb().public.one(
      `SELECT id FROM tasters WHERE owner_account_id = 'u2' AND is_self = true`,
    ) as { id: string }).id;
    expect(u1self).not.toBe(u2self);
    expect(count(`SELECT COUNT(*)::int AS n FROM tastes WHERE user_id = 'u1' AND taster_id = '${u1self}'`)).toBe(2);
    expect(count(`SELECT COUNT(*)::int AS n FROM tastes WHERE user_id = 'u2' AND taster_id = '${u2self}'`)).toBe(1);
    // Alice's rows are NOT pointed at Bob's self-taster.
    expect(count(`SELECT COUNT(*)::int AS n FROM tastes WHERE user_id = 'u1' AND taster_id = '${u2self}'`)).toBe(0);
  });

  it('ensureSelfTaster is idempotent — re-running creates no duplicate self row', async () => {
    const db = memdb();
    db.public.none(`INSERT INTO users (id, display_name) VALUES ('u1','Alice');`);

    const first = await ensureSelfTaster('u1');
    const again = await ensureSelfTaster('u1');

    expect(count(`SELECT COUNT(*)::int AS n FROM tasters WHERE owner_account_id = 'u1' AND is_self = true`)).toBe(1);
    // Same row returned both times (idempotent — auto-create on registration must
    // not mint a second self-taster on a repeat call).
    expect(again.id).toBe(first.id);
    expect(first.isSelf).toBe(true);
  });
});

describe('createTaste taster attribution', () => {
  beforeEach(async () => {
    memdb().public.none(`INSERT INTO users (id, display_name, plan) VALUES ('u1','Alice','pro');`);
  });

  it('stamps an explicit taster_id onto the new row', async () => {
    const db = memdb();
    // u1 has a self-taster and a second (pro) taster.
    const self = await ensureSelfTaster('u1');
    db.public.none(
      `INSERT INTO tasters (id, owner_account_id, display_name, is_self) VALUES ('ts_partner','u1','Partner',false);`,
    );

    await createTaste('u1', { name: 'For Partner', verdict: 'yum', tasterId: 'ts_partner' } as never);

    const row = memdb().public.one(
      `SELECT taster_id FROM tastes WHERE name = 'For Partner'`,
    ) as { taster_id: string };
    expect(row.taster_id).toBe('ts_partner');
    expect(row.taster_id).not.toBe(self.id);
  });

  it("falls back to the caller's self-taster when no taster_id is given", async () => {
    const self = await ensureSelfTaster('u1');
    await createTaste('u1', { name: 'Default Owner', verdict: 'meh' });
    const row = memdb().public.one(
      `SELECT taster_id FROM tastes WHERE name = 'Default Owner'`,
    ) as { taster_id: string };
    expect(row.taster_id).toBe(self.id);
  });

  it("rejects another account's taster id (IDOR) and writes nothing", async () => {
    const db = memdb();
    // u2 owns a persona; u1 is authenticated and tries to stamp it on a record.
    db.public.none(`INSERT INTO users (id, display_name, plan) VALUES ('u2','Bob','pro');`);
    db.public.none(
      `INSERT INTO tasters (id, owner_account_id, display_name, is_self) VALUES ('ts_bob','u2','Bob Persona',false);`,
    );

    // The helper must reject (not silently fall back, not insert).
    await expect(
      createTaste('u1', { name: 'Poison', verdict: 'yum', tasterId: 'ts_bob' } as never),
    ).rejects.toMatchObject({ name: 'CreateTasteError', code: 'invalid_taster' });
    // No row was written for u1 — the foreign attribution never reached the DB.
    expect(count(`SELECT COUNT(*)::int AS n FROM tastes WHERE name = 'Poison'`)).toBe(0);
    expect(count(`SELECT COUNT(*)::int AS n FROM tastes WHERE taster_id = 'ts_bob'`)).toBe(0);
  });
});

describe('listTastes taster filter', () => {
  it('returns only the requested taster rows when { taster } is passed', async () => {
    const db = memdb();
    db.public.none(`INSERT INTO users (id, display_name, plan) VALUES ('u1','Alice','pro');`);
    const self = await ensureSelfTaster('u1');
    db.public.none(
      `INSERT INTO tasters (id, owner_account_id, display_name, is_self) VALUES ('ts_partner','u1','Partner',false);`,
    );

    await createTaste('u1', { name: 'Mine A', verdict: 'yum' }); // → self
    await createTaste('u1', { name: 'Mine B', verdict: 'nah' }); // → self
    await createTaste('u1', { name: 'Theirs', verdict: 'meh', tasterId: 'ts_partner' } as never);

    const selfRows = await listTastes('u1', { taster: self.id } as never);
    expect(selfRows).toHaveLength(2);
    expect(selfRows.every((t) => ['Mine A', 'Mine B'].includes(t.name))).toBe(true);

    const partnerRows = await listTastes('u1', { taster: 'ts_partner' } as never);
    expect(partnerRows).toHaveLength(1);
    expect(partnerRows[0].name).toBe('Theirs');
  });

  it("yields no rows for a taster the caller does not own (cross-user scope)", async () => {
    const db = memdb();
    db.public.none(`INSERT INTO users (id, display_name, plan) VALUES ('u1','Alice','pro'),('u2','Bob','pro');`);
    await ensureSelfTaster('u1');
    // u2 has a persona with real records under u2.
    const u2self = await ensureSelfTaster('u2');
    await createTaste('u2', { name: 'Bob Secret', verdict: 'yum' });

    // u1 asks to list by u2's taster id — must return nothing, not u2's rows.
    const leaked = await listTastes('u1', { taster: u2self.id } as never);
    expect(leaked).toHaveLength(0);
  });
});

describe('ensureSelfTaster race guard', () => {
  beforeEach(() => withSelfIndex());
  afterEach(() => dropSelfIndex());

  it('the partial unique index rejects a second is_self taster for one owner', () => {
    const db = memdb();
    db.public.none(`INSERT INTO users (id, display_name) VALUES ('u1','Alice');`);
    db.public.none(
      `INSERT INTO tasters (id, owner_account_id, display_name, is_self) VALUES ('s1','u1','Me',true);`,
    );
    // A racing INSERT of a second is_self row must be rejected by the DB — this
    // is the guard that stops two concurrent first-saves from splitting attribution.
    expect(() =>
      db.public.none(
        `INSERT INTO tasters (id, owner_account_id, display_name, is_self) VALUES ('s2','u1','Me Again',true);`,
      ),
    ).toThrow();
    expect(count(`SELECT COUNT(*)::int AS n FROM tasters WHERE owner_account_id = 'u1' AND is_self = true`)).toBe(1);
  });

  it('two concurrent first-saves resolve to ONE self-taster (catch/re-SELECT path)', async () => {
    const db = memdb();
    db.public.none(`INSERT INTO users (id, display_name) VALUES ('u1','Alice');`);

    // Race two ensureSelfTaster calls before either has committed a self-taster.
    // Both run their guard SELECT (both see nothing), then both INSERT — the
    // partial unique index lets exactly one win; the loser's INSERT raises
    // unique_violation (23505) and ensureSelfTaster's catch re-SELECTs the
    // winner. Without the index + catch, this inserts TWO is_self rows and the
    // two callers return different ids (the split-attribution bug).
    const [a, b] = await Promise.all([ensureSelfTaster('u1'), ensureSelfTaster('u1')]);

    expect(count(`SELECT COUNT(*)::int AS n FROM tasters WHERE owner_account_id = 'u1' AND is_self = true`)).toBe(1);
    // Both callers converge on the SAME id — no split attribution downstream.
    expect(a.id).toBe(b.id);
    expect(a.isSelf).toBe(true);
  });
});
