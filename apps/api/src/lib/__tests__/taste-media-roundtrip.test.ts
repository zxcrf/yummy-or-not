// S3b Phase 2 — createTaste/rowToTaste media round-trip (db layer).
//
// Pins ⟦C3⟧:
//   - a VIDEO row persists media_type/clip_key/duration_ms and rowToTaste resolves
//     clip_key → a presigned GET (clipUrl) + emits mediaType/durationMs. `image`
//     is the POSTER and resolves through the unchanged variant path.
//   - an IMAGE row is unaffected: mediaType defaults 'image', clipUrl absent,
//     durationMs null, clip_key NULL in the DB.
//   - DELETE-path key fetch: getRawClipKey returns the raw clip key (video) / null
//     (image), which the DELETE route uses for ⟦DR#4⟧ clip cleanup.
//
// Runs against pg-mem injected for the `pg` Pool, same harness as
// update-taste-image.test.ts.

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

// s3 backend so the poster variant path presigns (deterministic via the storage
// mock) AND so the clip_key → clipUrl resolution runs through getSignedPhotoUrl.
jest.mock('../env', () => ({
  getPhotoStorage: jest.fn().mockReturnValue('s3'),
  getPhotoPublicBaseUrl: jest.fn().mockReturnValue(''),
  getPhotoCdnBaseUrl: jest.fn().mockReturnValue(''),
}));

jest.mock('../storage', () => ({
  // Deterministic presign: echo the key so assertions can prove WHICH key signed.
  getSignedPhotoUrl: jest.fn(async (key: string) => `https://r2.example/${key}?sig=abc`),
}));

import { createUser, createTaste, getTaste, getRawClipKey } from '../db';

const memdb = () => (globalThis as Record<string, unknown>).__memdb as IMemoryDb;

const CLIP_KEY = 'u/UID/clips/aaaa/clip.mp4';

function createSchema() {
  const db = memdb();
  db.public.none(`
    CREATE TABLE users (
      id            text PRIMARY KEY DEFAULT gen_random_uuid(),
      display_name  text NOT NULL DEFAULT '',
      phone         text, email text, password_hash text,
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
      price      numeric(10,2), place text,
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
  db.public.none('DELETE FROM tasters');
  db.public.none('DELETE FROM users');
});

describe('createTaste/rowToTaste — video media round-trip', () => {
  it('persists a video row and resolves clip_key → clipUrl + emits mediaType/durationMs', async () => {
    const user = await createUser({ email: 'a@example.com', displayName: 'a' });
    const created = await createTaste(
      user.id,
      { name: 'Ramen', verdict: 'yum', mediaType: 'video', clipKey: CLIP_KEY, durationMs: 8000 },
      't/00000000-0000-0000-0000-000000000099/orig.jpg' // poster rides the photo path
    );

    expect(created.mediaType).toBe('video');
    expect(created.durationMs).toBe(8000);
    // clipUrl is the presigned GET of the clip key (the storage mock echoes the key).
    expect(created.clipUrl).toBe(`https://r2.example/${CLIP_KEY}?sig=abc`);
    // The poster still resolves through the variant path into image/display.
    expect(created.imageDisplay).toContain('display.webp');

    // Raw DB columns persisted.
    const row = memdb().public.one(`SELECT media_type, clip_key, duration_ms FROM tastes WHERE id = '${created.id}'`) as {
      media_type: string;
      clip_key: string;
      duration_ms: number;
    };
    expect(row.media_type).toBe('video');
    expect(row.clip_key).toBe(CLIP_KEY);
    expect(Number(row.duration_ms)).toBe(8000);
  });

  it('an image row is unaffected: mediaType="image", clipUrl absent, durationMs null, clip_key NULL', async () => {
    const user = await createUser({ email: 'b@example.com', displayName: 'b' });
    const created = await createTaste(user.id, { name: 'Snack', verdict: 'meh' });

    expect(created.mediaType).toBe('image');
    expect(created.clipUrl).toBeUndefined();
    expect(created.durationMs).toBeNull();

    const row = memdb().public.one(`SELECT media_type, clip_key, duration_ms FROM tastes WHERE id = '${created.id}'`) as {
      media_type: string;
      clip_key: string | null;
      duration_ms: number | null;
    };
    expect(row.media_type).toBe('image');
    expect(row.clip_key).toBeNull();
    expect(row.duration_ms).toBeNull();
  });

  it('createTaste FORCES clip fields null on a non-video create (DB invariant safety)', async () => {
    const user = await createUser({ email: 'c@example.com', displayName: 'c' });
    // A caller that leaks clipKey on an image create must not persist it.
    const created = await createTaste(user.id, {
      name: 'Snack',
      verdict: 'yum',
      clipKey: CLIP_KEY,
      durationMs: 9000,
    } as never);
    const row = memdb().public.one(`SELECT media_type, clip_key, duration_ms FROM tastes WHERE id = '${created.id}'`) as {
      media_type: string;
      clip_key: string | null;
      duration_ms: number | null;
    };
    expect(row.media_type).toBe('image');
    expect(row.clip_key).toBeNull();
    expect(row.duration_ms).toBeNull();
  });

  it('getRawClipKey returns the clip key for a video row and null for an image row', async () => {
    const user = await createUser({ email: 'd@example.com', displayName: 'd' });
    const video = await createTaste(
      user.id,
      { name: 'V', verdict: 'yum', mediaType: 'video', clipKey: CLIP_KEY, durationMs: 5000 },
      'poster-key'
    );
    const image = await createTaste(user.id, { name: 'I', verdict: 'yum' });

    expect(await getRawClipKey(user.id, video.id)).toBe(CLIP_KEY);
    expect(await getRawClipKey(user.id, image.id)).toBeNull();
    // Ownership-scoped: a different user cannot read the clip key.
    expect(await getRawClipKey('someone-else', video.id)).toBeNull();
    // Round-trip via getTaste resolves clipUrl too.
    const refetched = await getTaste(user.id, video.id);
    expect(refetched?.clipUrl).toBe(`https://r2.example/${CLIP_KEY}?sig=abc`);
  });
});
