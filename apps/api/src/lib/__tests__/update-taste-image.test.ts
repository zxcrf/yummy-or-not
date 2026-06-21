// Regression: PATCH /api/tastes/[id] must NOT let a client change the stored
// `image` column. `updateTaste` previously mapped `image` straight to SQL, so an
// attacker could PATCH {"image":"t/<victim-uuid>/orig.jpg"} on their own taste
// and then mint a presigned original of someone else's object via /original
// (IDOR). This pins that `image` is dropped from the patch surface: a patch that
// includes `image` updates the other fields but leaves the image column intact.
//
// Runs against pg-mem (in-memory Postgres) injected for the `pg` Pool, same as
// promo-redeem.test.ts.

import { type IMemoryDb } from 'pg-mem';

jest.mock('pg', () => {
  const { newDb, DataType: DT } = require('pg-mem');
  const db = newDb();
  let n = 0;
  db.public.registerFunction({
    name: 'gen_random_uuid',
    returns: DT.text,
    impure: true,
    implementation: () => `00000000-0000-0000-0000-${String(++n).padStart(12, '0')}`,
  });
  (globalThis as Record<string, unknown>).__memdb = db;
  return db.adapters.createPg();
});

// Deterministic, presign-free URL resolution: local backend, no base URL, so a
// variant key resolves to `/t/<uuid>/display.webp` — easy to assert on.
jest.mock('../env', () => ({
  getPhotoStorage: jest.fn().mockReturnValue('local'),
  getPhotoPublicBaseUrl: jest.fn().mockReturnValue(''),
  getPhotoCdnBaseUrl: jest.fn().mockReturnValue(''),
}));

import { createUser, createTaste, updateTaste } from '../db';

const memdb = () => (globalThis as Record<string, unknown>).__memdb as IMemoryDb;

const OWN_UUID = '11111111-1111-1111-1111-111111111111';
const VICTIM_UUID = '99999999-9999-9999-9999-999999999999';
const ownKey = `t/${OWN_UUID}/orig.jpg`;
const victimKey = `t/${VICTIM_UUID}/orig.jpg`;

function createSchema() {
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
  db.public.none(`
    CREATE TABLE tastes (
      id           text PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id      text NOT NULL REFERENCES users(id),
      name         text NOT NULL,
      place        text NOT NULL DEFAULT '',
      price        text NOT NULL DEFAULT '',
      status       text NOT NULL DEFAULT 'tasted' CHECK (status IN ('tasted','todo')),
      verdict      text CHECK (verdict IN ('yum','meh','nah')),
      tags         text[] NOT NULL DEFAULT '{}',
      bought_count    int NOT NULL DEFAULT 1,
      warn_before_buy boolean NOT NULL DEFAULT false,
      notes           text NOT NULL DEFAULT '',
      image           text NOT NULL DEFAULT '',
      lat             double precision,
      lng             double precision,
      taster_id       text,
      media_type      text NOT NULL DEFAULT 'image',
      clip_key        text,
      duration_ms     integer,
      created_at      timestamptz NOT NULL DEFAULT now()
    );
  `);
  // S3b (migration 0008): createUser / createTaste resolve a self-taster — mirror prod.
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
}

beforeAll(() => {
  createSchema();
});

beforeEach(() => {
  const db = memdb();
  db.public.none('DELETE FROM tastes');
  db.public.none('DELETE FROM users');
});

it('ignores a client-supplied image in PATCH (cannot repoint at another user\'s key)', async () => {
  const user = await createUser({ email: 'a@example.com', displayName: 'a' });
  const created = await createTaste(user.id, { name: 'Snack', verdict: 'yum' }, ownKey);

  const updated = await updateTaste(user.id, created.id, {
    name: 'Renamed',
    image: victimKey,
  } as never);

  expect(updated).not.toBeNull();
  // updateTaste returns Taste | error-string | null; narrow to the Taste.
  if (updated === null || typeof updated === 'string') {
    throw new Error(`expected a Taste, got ${String(updated)}`);
  }
  // The benign field updated…
  expect(updated.name).toBe('Renamed');
  // …but the image column did NOT change to the victim key.
  expect(updated.imageDisplay).toContain(OWN_UUID);
  expect(updated.imageDisplay).not.toContain(VICTIM_UUID);

  // Confirm at the storage layer too: the raw column is still the owned key.
  const row = memdb().public.one(
    `SELECT image FROM tastes WHERE id = '${created.id}'`,
  ) as { image: string };
  expect(row.image).toBe(ownKey);
});

it('trusted server image option sets image and returns previous image', async () => {
  const user = await createUser({ email: 'owner@example.com', displayName: 'owner' });
  const created = await createTaste(user.id, { name: 'Snack', verdict: 'yum', notes: 'old' }, ownKey);
  const newKey = 't/22222222-2222-2222-2222-222222222222/orig.jpg';

  const result = await updateTaste(
    user.id,
    created.id,
    { name: 'Snack edited' },
    { imageKey: newKey },
  );

  expect(result).not.toBeNull();
  if (result === null || typeof result === 'string' || !('previousImage' in result)) {
    throw new Error(`expected image update result, got ${String(result)}`);
  }
  expect(result.previousImage).toBe(ownKey);
  expect(result.taste.name).toBe('Snack edited');
  expect(result.taste.notes).toBe('old');

  const row = memdb().public.one(
    `SELECT image, name, notes FROM tastes WHERE id = '${created.id}'`,
  ) as { image: string; name: string; notes: string };
  expect(row.image).toBe(newKey);
  expect(row.name).toBe('Snack edited');
  expect(row.notes).toBe('old');
});

// Regression: updateTaste had NO lat/lng in its field map, so a PATCH that
// changed the pin was silently dropped — the column never moved. Editing a
// taste's physical location must persist; clearing it (null) must wipe it.
it('persists a lat/lng pin patch and clears it with null', async () => {
  const user = await createUser({ email: 'pin@example.com', displayName: 'pin' });
  const created = await createTaste(user.id, { name: 'Boba', verdict: 'yum' });

  // Set a pin.
  const set = await updateTaste(user.id, created.id, { lat: 31.2304, lng: 121.4737 });
  if (set === null || typeof set === 'string') throw new Error(`expected a Taste, got ${String(set)}`);
  expect(set.lat).toBeCloseTo(31.2304, 4);
  expect(set.lng).toBeCloseTo(121.4737, 4);

  const setRow = memdb().public.one(
    `SELECT lat, lng FROM tastes WHERE id = '${created.id}'`,
  ) as { lat: number; lng: number };
  expect(setRow.lat).toBeCloseTo(31.2304, 4);
  expect(setRow.lng).toBeCloseTo(121.4737, 4);

  // Clear it with explicit null.
  const cleared = await updateTaste(user.id, created.id, { lat: null, lng: null });
  if (cleared === null || typeof cleared === 'string') throw new Error(`expected a Taste, got ${String(cleared)}`);
  expect(cleared.lat).toBeNull();
  expect(cleared.lng).toBeNull();
});

// A patch that doesn't mention coordinates must leave an existing pin intact —
// the `'lat' in patch` guard means an unrelated edit never wipes the pin.
it('leaves the pin untouched when the patch omits lat/lng', async () => {
  const user = await createUser({ email: 'keep-pin@example.com', displayName: 'keep' });
  const created = await createTaste(user.id, { name: 'Latte', verdict: 'yum', lat: 1.5, lng: 2.5 });

  const updated = await updateTaste(user.id, created.id, { name: 'Flat White' });
  if (updated === null || typeof updated === 'string') throw new Error(`expected a Taste, got ${String(updated)}`);
  expect(updated.name).toBe('Flat White');
  expect(updated.lat).toBeCloseTo(1.5, 4);
  expect(updated.lng).toBeCloseTo(2.5, 4);
});

// Out-of-range / non-finite coordinates are clamped to null on write (parity
// with the create path) so a malformed patch can't store garbage.
it('clamps an out-of-range coordinate patch to null', async () => {
  const user = await createUser({ email: 'clamp@example.com', displayName: 'clamp' });
  const created = await createTaste(user.id, { name: 'Tea', verdict: 'yum', lat: 10, lng: 20 });

  const updated = await updateTaste(user.id, created.id, { lat: 999, lng: 121 });
  if (updated === null || typeof updated === 'string') throw new Error(`expected a Taste, got ${String(updated)}`);
  expect(updated.lat).toBeNull();
  expect(updated.lng).toBeCloseTo(121, 4);
});

it('trusted server image option returns null for non-owner and does not alter columns', async () => {
  const owner = await createUser({ email: 'real-owner@example.com', displayName: 'owner' });
  const stranger = await createUser({ email: 'stranger@example.com', displayName: 'stranger' });
  const created = await createTaste(owner.id, { name: 'Snack', verdict: 'yum', notes: 'old' }, ownKey);
  const newKey = 't/33333333-3333-3333-3333-333333333333/orig.jpg';

  const result = await updateTaste(stranger.id, created.id, { name: 'Hacked' }, { imageKey: newKey });

  expect(result).toBeNull();
  const row = memdb().public.one(
    `SELECT image, name, notes FROM tastes WHERE id = '${created.id}'`,
  ) as { image: string; name: string; notes: string };
  expect(row.image).toBe(ownKey);
  expect(row.name).toBe('Snack');
  expect(row.notes).toBe('old');
});
