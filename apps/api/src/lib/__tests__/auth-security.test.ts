import { createHash } from 'crypto';
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
      `00000000-0000-0000-0000-${String(++n).padStart(12, '0')}`,
  });
  (globalThis as Record<string, unknown>).__authMemdb = db;
  return db.adapters.createPg();
});

import { createSession, deleteSession, getSessionUser, hitRateLimit } from '../db';

const memdb = () => (globalThis as Record<string, unknown>).__authMemdb as IMemoryDb;
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

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
    CREATE TABLE sessions (
      token       text UNIQUE,
      token_hash  text UNIQUE,
      user_id     text NOT NULL REFERENCES users(id),
      user_agent  text NOT NULL DEFAULT '',
      created_at  timestamptz NOT NULL DEFAULT now(),
      expires_at  timestamptz NOT NULL,
      CHECK (token IS NOT NULL OR token_hash IS NOT NULL)
    );
  `);
  db.public.none(`
    CREATE TABLE rate_limits (
      key        text PRIMARY KEY,
      count      int NOT NULL DEFAULT 0,
      reset_at   timestamptz NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);
}

beforeAll(() => {
  createSchema();
});

beforeEach(() => {
  const db = memdb();
  db.public.none('DELETE FROM sessions;');
  db.public.none('DELETE FROM users;');
  db.public.none('DELETE FROM rate_limits;');
  db.public.none(`
    INSERT INTO users (id, display_name, email)
    VALUES ('u1', 'A', 'a@x.com');
  `);
});

describe('session token persistence', () => {
  it('stores only a token hash for new sessions', async () => {
    await createSession('plain-token', 'u1', new Date(Date.now() + 60_000), 'jest');

    const row = memdb().public.one('SELECT token, token_hash FROM sessions') as {
      token: string | null;
      token_hash: string;
    };
    expect(row.token).toBeNull();
    expect(row.token_hash).toBe(sha256('plain-token'));
  });

  it('resolves hash-backed sessions and deletes them by bearer token', async () => {
    await createSession('plain-token', 'u1', new Date(Date.now() + 60_000), 'jest');

    await expect(getSessionUser('plain-token')).resolves.toMatchObject({ id: 'u1' });
    await deleteSession('plain-token');
    await expect(getSessionUser('plain-token')).resolves.toBeNull();
  });

  it('keeps legacy plaintext sessions readable during migration', async () => {
    memdb().public.none(`
      INSERT INTO sessions (token, user_id, expires_at)
      VALUES ('legacy-token', 'u1', now() + interval '1 hour');
    `);

    await expect(getSessionUser('legacy-token')).resolves.toMatchObject({ id: 'u1' });
  });
});

describe('hitRateLimit', () => {
  it('allows requests up to the limit and blocks the next one', async () => {
    await expect(hitRateLimit('k1', 2, 60_000)).resolves.toMatchObject({ limited: false });
    await expect(hitRateLimit('k1', 2, 60_000)).resolves.toMatchObject({ limited: false });

    const third = await hitRateLimit('k1', 2, 60_000);
    expect(third.limited).toBe(true);
    expect(third.retryAfterSeconds).toBeGreaterThan(0);
  });
});
