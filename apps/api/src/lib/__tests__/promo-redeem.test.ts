// Integration tests for the transactional promo-redeem path (lib/db.ts).
//
// The pure helpers (normalize/generate/isExpired/hasUsesLeft) are covered in
// promo.test.ts. THIS file pins the parts that actually carry risk and had zero
// coverage: oversell prevention, double-redeem idempotency, the
// already-redeemed-vs-exhausted error precedence, and the plan upgrade — all of
// which only manifest against a real SQL engine (FOR UPDATE, UNIQUE, ON
// CONFLICT, transactions). We run them against an in-memory Postgres (pg-mem)
// injected in place of the real `pg` Pool, so they execute in CI with no DB.
//
// Regression anchor: `redeem of an exhausted single-use code by the user who
// already redeemed it returns already_redeemed, NOT code_exhausted`. That test
// fails against the pre-fix ordering (exhausted check before the
// already-redeemed check) and passes after it.

import { type IMemoryDb } from 'pg-mem';

// jest.mock is hoisted above imports; build the in-memory DB *inside* the
// factory (it may only close over `mock`-prefixed names) and stash it on
// globalThis so the test body can create the schema on the same instance.
jest.mock('pg', () => {
  const { newDb, DataType: DT } = require('pg-mem');
  const db = newDb();
  let n = 0;
  // The schema's `id text DEFAULT gen_random_uuid()` needs this registered.
  db.public.registerFunction({
    name: 'gen_random_uuid',
    returns: DT.text,
    // impure: pg-mem otherwise constant-folds a "pure" fn to one cached value,
    // so every row would get the same id and collide on the users PK.
    impure: true,
    implementation: () =>
      `00000000-0000-0000-0000-${String(++n).padStart(12, '0')}`,
  });
  (globalThis as Record<string, unknown>).__memdb = db;
  return db.adapters.createPg();
});

// Import AFTER the mock so db.ts's Pool is the pg-mem one.
import { createUser, getPromoCode, redeemPromoCode } from '../db';
import { normalizePromoCode } from '../promo';

const memdb = () => (globalThis as Record<string, unknown>).__memdb as IMemoryDb;

/** Minimal schema (no DROPs, no extensions) mirroring the prod columns the
 *  redeem path touches. */
function createSchema() {
  // pg-mem chokes on several PRIMARY KEY tables in one multi-statement batch
  // (auto index-name collision), so each CREATE goes through its own call.
  const db = memdb();
  db.public.none(`
    CREATE TABLE users (
      id            text PRIMARY KEY DEFAULT gen_random_uuid(),
      display_name  text NOT NULL DEFAULT '',
      phone         text,
      email         text,
      password_hash text,
      avatar        text NOT NULL DEFAULT '',
      locale        text NOT NULL DEFAULT 'zh',
      plan          text NOT NULL DEFAULT 'free' CHECK (plan IN ('free','pro')),
      location_enabled boolean NOT NULL DEFAULT false,
      created_at    timestamptz NOT NULL DEFAULT now()
    );
  `);
  // S3b (migration 0008): createUser auto-creates a self-taster — mirror prod.
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
    CREATE TABLE promo_codes (
      code        text PRIMARY KEY,
      grants_plan text NOT NULL DEFAULT 'pro' CHECK (grants_plan IN ('free','pro')),
      max_uses    int  NOT NULL DEFAULT 1,
      used_count  int  NOT NULL DEFAULT 0,
      note        text NOT NULL DEFAULT '',
      created_by  text,
      expires_at  timestamptz,
      created_at  timestamptz NOT NULL DEFAULT now()
    );
  `);
  db.public.none(`
    CREATE TABLE promo_redemptions (
      id          serial PRIMARY KEY,
      code        text NOT NULL REFERENCES promo_codes(code),
      user_id     text NOT NULL REFERENCES users(id),
      redeemed_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (code, user_id)
    );
  `);
}

function seedCode(opts: {
  code: string;
  maxUses?: number;
  expiresAt?: string | null;
  grants?: 'free' | 'pro';
}) {
  memdb().public.none(`
    INSERT INTO promo_codes (code, grants_plan, max_uses, expires_at)
    VALUES (
      '${normalizePromoCode(opts.code)}',
      '${opts.grants ?? 'pro'}',
      ${opts.maxUses ?? 1},
      ${opts.expiresAt ? `'${opts.expiresAt}'` : 'NULL'}
    );
  `);
}

const usedCount = (code: string): number =>
  (memdb().public.one(
    `SELECT used_count FROM promo_codes WHERE code = '${normalizePromoCode(code)}'`,
  ) as { used_count: number }).used_count;

async function mkUser(email: string) {
  return createUser({ email, displayName: email.split('@')[0] });
}

// pg-mem keeps an index's auto-name reserved after a DROP TABLE, so re-creating
// the schema per test collides. Create it once, then wipe rows between tests.
beforeAll(() => {
  createSchema();
});

beforeEach(() => {
  const db = memdb();
  db.public.none('DELETE FROM promo_redemptions;');
  db.public.none('DELETE FROM promo_codes;');
  db.public.none('DELETE FROM users;');
});

describe('redeemPromoCode', () => {
  it('rejects an unknown code with invalid_code', async () => {
    const u = await mkUser('a@x.com');
    const r = await redeemPromoCode(u.id, 'NOPE-1');
    expect(r).toEqual({ ok: false, error: 'invalid_code' });
  });

  it('rejects an expired code with code_expired (no plan change)', async () => {
    seedCode({ code: 'EXP-1', expiresAt: '2000-01-01T00:00:00Z' });
    const u = await mkUser('b@x.com');
    const r = await redeemPromoCode(u.id, 'EXP-1');
    expect(r).toEqual({ ok: false, error: 'code_expired' });
    expect(usedCount('EXP-1')).toBe(0);
  });

  it('upgrades the user to the granted plan and bumps used_count once', async () => {
    seedCode({ code: 'GO-1', maxUses: 5, grants: 'pro' });
    const u = await mkUser('c@x.com');
    expect(u.plan).toBe('free');
    const r = await redeemPromoCode(u.id, 'go-1'); // also exercises normalization
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.user.plan).toBe('pro');
    expect(usedCount('GO-1')).toBe(1);
  });

  it('is idempotent: a second redeem by the same user returns already_redeemed and does NOT double-count', async () => {
    seedCode({ code: 'IDEM-1', maxUses: 5 });
    const u = await mkUser('d@x.com');
    const first = await redeemPromoCode(u.id, 'IDEM-1');
    expect(first.ok).toBe(true);
    const second = await redeemPromoCode(u.id, 'IDEM-1');
    expect(second).toEqual({ ok: false, error: 'already_redeemed' });
    expect(usedCount('IDEM-1')).toBe(1); // not double-bumped
  });

  // NOTE: pg-mem is single-threaded, so this pins the *completed* exhaustion
  // behaviour but does NOT exercise the `SELECT … FOR UPDATE` row lock under
  // genuine concurrency — this test would still pass if the lock were removed.
  // True oversell-under-race coverage needs a real Postgres with parallel
  // connections (a CI integration job), tracked as a follow-up.
  it('cannot be oversold: a single-use code redeemed by a second user returns code_exhausted', async () => {
    seedCode({ code: 'ONE-1', maxUses: 1 });
    const a = await mkUser('e@x.com');
    const b = await mkUser('f@x.com');
    const ra = await redeemPromoCode(a.id, 'ONE-1');
    expect(ra.ok).toBe(true);
    const rb = await redeemPromoCode(b.id, 'ONE-1');
    expect(rb).toEqual({ ok: false, error: 'code_exhausted' });
    expect(usedCount('ONE-1')).toBe(1); // b did not consume a use
  });

  // REGRESSION (fix: already-redeemed check now precedes the exhausted check).
  // Pre-fix this returned code_exhausted because max_uses was already hit.
  it('returns already_redeemed (not code_exhausted) when the redeemer re-redeems an exhausted single-use code', async () => {
    seedCode({ code: 'SELF-1', maxUses: 1 });
    const u = await mkUser('g@x.com');
    const first = await redeemPromoCode(u.id, 'SELF-1');
    expect(first.ok).toBe(true);
    // code is now exhausted (used_count == max_uses == 1) AND this user already redeemed it
    const again = await redeemPromoCode(u.id, 'SELF-1');
    expect(again).toEqual({ ok: false, error: 'already_redeemed' });
    expect(usedCount('SELF-1')).toBe(1);
  });

  it('treats max_uses <= 0 as unlimited (many distinct users can redeem)', async () => {
    seedCode({ code: 'INF-1', maxUses: 0 });
    for (const email of ['h@x.com', 'i@x.com', 'j@x.com']) {
      const u = await mkUser(email);
      const r = await redeemPromoCode(u.id, 'INF-1');
      expect(r.ok).toBe(true);
    }
    expect(usedCount('INF-1')).toBe(3);
  });

  it('seeds via getPromoCode roundtrip in canonical form', async () => {
    seedCode({ code: 'RT-1' });
    const got = await getPromoCode('rt-1');
    expect(got?.code).toBe('RT-1');
  });
});
