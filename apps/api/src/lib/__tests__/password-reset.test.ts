/* Password-reset db helpers — exercised against an in-memory Postgres (pg-mem)
   so the real SQL (single-use UPDATE, expiry, FK) runs, not a mock.

   Pins the security-critical behaviors of the reset flow:
     • the token is stored HASHED, never raw;
     • an expired token is rejected;
     • a used token is rejected (single-use), and consuming is atomic;
     • setUserPasswordHash swaps the hash so the old password stops verifying;
     • deleteUserSessions revokes every session for the user. */
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
  (globalThis as Record<string, unknown>).__pwResetMemdb = db;
  return db.adapters.createPg();
});

import {
  createSession,
  getSessionUser,
  savePasswordResetToken,
  consumePasswordResetToken,
  setUserPasswordHash,
  deleteUserSessions,
} from '../db';
import { hashCode, hashPassword, verifyPassword } from '../auth';

const memdb = () => (globalThis as Record<string, unknown>).__pwResetMemdb as IMemoryDb;

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
    CREATE TABLE password_reset_tokens (
      token_hash text PRIMARY KEY,
      user_id    text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      email      text,
      expires_at timestamptz NOT NULL,
      used_at    timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
}

beforeAll(() => {
  createSchema();
});

beforeEach(() => {
  const db = memdb();
  db.public.none('DELETE FROM password_reset_tokens;');
  db.public.none('DELETE FROM sessions;');
  db.public.none('DELETE FROM users;');
  db.public.none(`
    INSERT INTO users (id, display_name, email, password_hash)
    VALUES ('u1', 'A', 'a@x.com', ${"'" + hashPassword('oldpassword') + "'"});
  `);
});

const future = () => new Date(Date.now() + 30 * 60 * 1000);
const past = () => new Date(Date.now() - 60 * 1000);

describe('savePasswordResetToken', () => {
  it('stores only the token hash — never the raw token', async () => {
    const raw = 'raw-reset-token-abc';
    await savePasswordResetToken('u1', 'a@x.com', hashCode(raw), future());

    const row = memdb().public.one(
      'SELECT token_hash, email FROM password_reset_tokens'
    ) as { token_hash: string; email: string };

    expect(row.token_hash).toBe(hashCode(raw));
    // The raw token must not be recoverable from the row.
    expect(row.token_hash).not.toBe(raw);
    expect(row.token_hash).toBe(createHash('sha256').update(raw).digest('hex'));
  });
});

describe('consumePasswordResetToken', () => {
  it('returns the user id for a valid unexpired token', async () => {
    const raw = 'valid-token';
    await savePasswordResetToken('u1', 'a@x.com', hashCode(raw), future());
    await expect(consumePasswordResetToken(hashCode(raw))).resolves.toEqual({ userId: 'u1' });
  });

  it('rejects an expired token', async () => {
    const raw = 'expired-token';
    await savePasswordResetToken('u1', 'a@x.com', hashCode(raw), past());
    await expect(consumePasswordResetToken(hashCode(raw))).resolves.toBeNull();
  });

  it('rejects an unknown token', async () => {
    await expect(consumePasswordResetToken(hashCode('never-issued'))).resolves.toBeNull();
  });

  it('is single-use: a second consume of the same token fails', async () => {
    const raw = 'one-shot-token';
    await savePasswordResetToken('u1', 'a@x.com', hashCode(raw), future());

    await expect(consumePasswordResetToken(hashCode(raw))).resolves.toEqual({ userId: 'u1' });
    // already consumed → rejected
    await expect(consumePasswordResetToken(hashCode(raw))).resolves.toBeNull();

    const row = memdb().public.one(
      'SELECT used_at FROM password_reset_tokens'
    ) as { used_at: Date | null };
    expect(row.used_at).not.toBeNull();
  });
});

describe('the full reset effect (set hash + revoke sessions)', () => {
  it('replaces the password so the old one no longer verifies and the new one does', async () => {
    const raw = 'reset-then-login';
    await savePasswordResetToken('u1', 'a@x.com', hashCode(raw), future());

    const consumed = await consumePasswordResetToken(hashCode(raw));
    expect(consumed).toEqual({ userId: 'u1' });

    await setUserPasswordHash('u1', hashPassword('brandnewpass'));

    const row = memdb().public.one(
      "SELECT password_hash FROM users WHERE id = 'u1'"
    ) as { password_hash: string };
    expect(verifyPassword('oldpassword', row.password_hash)).toBe(false);
    expect(verifyPassword('brandnewpass', row.password_hash)).toBe(true);
  });

  it('revokes every existing session for the user', async () => {
    await createSession('sess-a', 'u1', future(), 'jest');
    await createSession('sess-b', 'u1', future(), 'jest');
    await expect(getSessionUser('sess-a')).resolves.toMatchObject({ id: 'u1' });

    await deleteUserSessions('u1');

    await expect(getSessionUser('sess-a')).resolves.toBeNull();
    await expect(getSessionUser('sess-b')).resolves.toBeNull();
    const { length } = memdb().public.many(
      "SELECT 1 FROM sessions WHERE user_id = 'u1'"
    );
    expect(length).toBe(0);
  });
});
