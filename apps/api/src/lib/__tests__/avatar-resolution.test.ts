// A3: the row→User mapper resolves users.avatar.
//   - a stored bare R2 key  → presigned GET URL (via resolvePhotoUrls flat-key)
//   - a legacy http(s) value → passthrough unchanged
//   - empty                  → ''
// Runs against pg-mem (in-process Postgres) so the full findUserById → rowToUser
// → resolveAvatarUrl path is exercised, with storage + env stubbed.

import { type IMemoryDb } from 'pg-mem';

jest.mock('pg', () => {
  const { newDb, DataType: DT } = require('pg-mem');
  const db = newDb();
  let n = 0;
  db.public.registerFunction({
    name: 'gen_random_uuid',
    returns: DT.text,
    impure: true,
    implementation: () => `00000000-0000-4000-0000-${String(++n).padStart(12, '0')}`,
  });
  (globalThis as Record<string, unknown>).__avMemdb = db;
  return db.adapters.createPg();
});

jest.mock('../env', () => ({
  getPhotoStorage: jest.fn().mockReturnValue('s3'),
  getPhotoPublicBaseUrl: jest.fn().mockReturnValue(''),
  getPhotoCdnBaseUrl: jest.fn().mockReturnValue(''),
}));

jest.mock('../storage', () => ({
  ...jest.requireActual('../storage'),
  getSignedPhotoUrl: jest.fn(
    (key: string) => Promise.resolve(`https://r2.example/${key}?X-Amz-Signature=sig`)
  ),
}));

import { findUserById } from '../db';

function memdb(): IMemoryDb {
  return (globalThis as Record<string, unknown>).__avMemdb as IMemoryDb;
}

beforeAll(() => {
  const db = memdb();
  db.public.none(`
    CREATE TABLE users (
      id text PRIMARY KEY DEFAULT gen_random_uuid(),
      display_name text DEFAULT '',
      phone text,
      email text,
      password_hash text,
      avatar text DEFAULT '',
      locale text DEFAULT 'zh',
      plan text DEFAULT 'free',
      warnings_enabled boolean DEFAULT true,
      location_enabled boolean DEFAULT false,
      media_enabled boolean DEFAULT false,
      default_visibility text DEFAULT 'private',
      created_at timestamptz DEFAULT now()
    );
  `);
});

beforeEach(() => {
  memdb().public.none('DELETE FROM users');
});

function insertUser(avatar: string): string {
  const { rows } = memdb().public.query(
    `INSERT INTO users (avatar) VALUES ('${avatar.replace(/'/g, "''")}') RETURNING id`
  ) as unknown as { rows: Array<{ id: string }> };
  return rows[0].id;
}

describe('avatar resolution in rowToUser', () => {
  it('presigns a bare R2 avatar key to a GET URL', async () => {
    const id = insertUser('u/u1/avatar/pic.jpg');
    const user = await findUserById(id);
    expect(user).not.toBeNull();
    expect(user!.avatar).toBe('https://r2.example/u/u1/avatar/pic.jpg?X-Amz-Signature=sig');
  });

  it('passes a legacy https avatar through unchanged', async () => {
    const id = insertUser('https://oauth.example/a.png');
    const user = await findUserById(id);
    expect(user!.avatar).toBe('https://oauth.example/a.png');
  });

  it('passes a /uploads/ legacy avatar through unchanged', async () => {
    const id = insertUser('/uploads/a.png');
    const user = await findUserById(id);
    expect(user!.avatar).toBe('/uploads/a.png');
  });

  it('resolves an empty avatar to empty string', async () => {
    const id = insertUser('');
    const user = await findUserById(id);
    expect(user!.avatar).toBe('');
  });
});
