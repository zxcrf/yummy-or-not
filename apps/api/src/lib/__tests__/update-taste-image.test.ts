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
      verdict      text NOT NULL CHECK (verdict IN ('yum','meh','nah')),
      tags         text[] NOT NULL DEFAULT '{}',
      bought_count int NOT NULL DEFAULT 1,
      notes        text NOT NULL DEFAULT '',
      image        text NOT NULL DEFAULT '',
      created_at   timestamptz NOT NULL DEFAULT now()
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
  // The benign field updated…
  expect(updated!.name).toBe('Renamed');
  // …but the image column did NOT change to the victim key.
  expect(updated!.imageDisplay).toContain(OWN_UUID);
  expect(updated!.imageDisplay).not.toContain(VICTIM_UUID);

  // Confirm at the storage layer too: the raw column is still the owned key.
  const row = memdb().public.one(
    `SELECT image FROM tastes WHERE id = '${created.id}'`,
  ) as { image: string };
  expect(row.image).toBe(ownKey);
});
