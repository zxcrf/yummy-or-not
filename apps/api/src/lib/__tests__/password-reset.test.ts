/* Password-reset db helpers — exercised against an in-memory Postgres (pg-mem)
   so the real SQL (single-use UPDATE, email binding, expiry, FK, transaction)
   runs, not a mock.

   Security properties pinned:
     • the token is stored HASHED, never raw;
     • an expired token is rejected;
     • a used token is rejected (single-use);
     • token must be bound to the issuing email — can't swap email to bypass
       the per-email rate-limit (MED 3);
     • a successful reset burns ALL other outstanding tokens for the user (MED 4);
     • the whole op (consume + burn + set-password + revoke-sessions) is atomic:
       when the consume step fails (wrong email, expired, unknown) the password
       and token remain unchanged (HIGH 2);
     • sessions are revoked after a successful reset. */
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
  applyPasswordReset,
} from '../db';
import { hashCode, hashPassword, verifyPassword } from '../auth';

const memdb = () => (globalThis as Record<string, unknown>).__pwResetMemdb as IMemoryDb;
const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

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
  db.public.none(
    `INSERT INTO users (id, display_name, email, password_hash)
     VALUES ('u1', 'A', 'a@x.com', '${hashPassword('oldpassword')}');`
  );
});

const future = () => new Date(Date.now() + 30 * 60 * 1000);
const past   = () => new Date(Date.now() - 60 * 1000);

// ── savePasswordResetToken ────────────────────────────────────────────────────

describe('savePasswordResetToken', () => {
  it('stores only the token hash — never the raw token', async () => {
    const raw = 'raw-reset-token-abc';
    await savePasswordResetToken('u1', 'a@x.com', hashCode(raw), future());

    const row = memdb().public.one(
      'SELECT token_hash, email FROM password_reset_tokens'
    ) as { token_hash: string; email: string };

    expect(row.token_hash).toBe(sha256(raw));
    expect(row.token_hash).not.toBe(raw);
  });
});

// ── applyPasswordReset — happy path ──────────────────────────────────────────

describe('applyPasswordReset — happy path', () => {
  it('returns the user id for a valid unexpired token matching the correct email', async () => {
    const raw = 'valid-token';
    await savePasswordResetToken('u1', 'a@x.com', hashCode(raw), future());
    await expect(
      applyPasswordReset(hashCode(raw), 'a@x.com', hashPassword('newpass123'))
    ).resolves.toEqual({ userId: 'u1' });
  });

  it('old password stops verifying; new one does', async () => {
    const raw = 'reset-then-login';
    await savePasswordResetToken('u1', 'a@x.com', hashCode(raw), future());
    await applyPasswordReset(hashCode(raw), 'a@x.com', hashPassword('brandnewpass'));

    const { password_hash } = memdb().public.one(
      "SELECT password_hash FROM users WHERE id = 'u1'"
    ) as { password_hash: string };
    expect(verifyPassword('oldpassword', password_hash)).toBe(false);
    expect(verifyPassword('brandnewpass', password_hash)).toBe(true);
  });

  it('revokes every existing session for the user', async () => {
    await createSession('sess-a', 'u1', future(), 'jest');
    await createSession('sess-b', 'u1', future(), 'jest');

    const raw = 'revoke-test';
    await savePasswordResetToken('u1', 'a@x.com', hashCode(raw), future());
    await applyPasswordReset(hashCode(raw), 'a@x.com', hashPassword('newpass123'));

    await expect(getSessionUser('sess-a')).resolves.toBeNull();
    await expect(getSessionUser('sess-b')).resolves.toBeNull();
    const rows = memdb().public.many("SELECT 1 FROM sessions WHERE user_id = 'u1'");
    expect(rows).toHaveLength(0);
  });
});

// ── applyPasswordReset — rejection cases ─────────────────────────────────────

describe('applyPasswordReset — rejection cases', () => {
  it('rejects an expired token', async () => {
    const raw = 'expired-token';
    await savePasswordResetToken('u1', 'a@x.com', hashCode(raw), past());
    await expect(
      applyPasswordReset(hashCode(raw), 'a@x.com', hashPassword('p'))
    ).resolves.toBeNull();
  });

  it('rejects an unknown token', async () => {
    await expect(
      applyPasswordReset(hashCode('never-issued'), 'a@x.com', hashPassword('p'))
    ).resolves.toBeNull();
  });

  it('is single-use: a second consume of the same token fails', async () => {
    const raw = 'one-shot';
    await savePasswordResetToken('u1', 'a@x.com', hashCode(raw), future());
    await expect(
      applyPasswordReset(hashCode(raw), 'a@x.com', hashPassword('newpass'))
    ).resolves.toEqual({ userId: 'u1' });
    await expect(
      applyPasswordReset(hashCode(raw), 'a@x.com', hashPassword('newpass'))
    ).resolves.toBeNull();

    // pg-mem's .one()/.many() don't support parameterised queries in test reads.
    // There is exactly one token row in this test so we can select all.
    const { used_at } = memdb().public.one(
      'SELECT used_at FROM password_reset_tokens'
    ) as { used_at: Date | null };
    expect(used_at).not.toBeNull();
  });

  it('rejects a token when supplied email differs from the issuing email (MED 3)', async () => {
    // Token issued for a@x.com; attacker supplies b@x.com to bypass the
    // per-email rate limiter while reusing the real token.
    const raw = 'email-bound-token';
    await savePasswordResetToken('u1', 'a@x.com', hashCode(raw), future());

    const result = await applyPasswordReset(hashCode(raw), 'b@x.com', hashPassword('newpass'));
    expect(result).toBeNull();

    // Token must still be unconsumed so the real owner can still use it.
    const { used_at } = memdb().public.one(
      'SELECT used_at FROM password_reset_tokens'
    ) as { used_at: Date | null };
    expect(used_at).toBeNull();
  });
});

// ── stale token invalidation (MED 4) ─────────────────────────────────────────

describe('stale token invalidation (MED 4)', () => {
  it('burns all other outstanding tokens for the user when one is consumed', async () => {
    const rawA = 'token-a';
    const rawB = 'token-b';
    await savePasswordResetToken('u1', 'a@x.com', hashCode(rawA), future());
    await savePasswordResetToken('u1', 'a@x.com', hashCode(rawB), future());

    // Consume token-a → token-b must be burned automatically.
    await applyPasswordReset(hashCode(rawA), 'a@x.com', hashPassword('newpass'));

    // token-b is now used and must be rejected.
    const result = await applyPasswordReset(hashCode(rawB), 'a@x.com', hashPassword('another'));
    expect(result).toBeNull();

    const rows = memdb().public.many(
      'SELECT used_at FROM password_reset_tokens'
    ) as { used_at: Date | null }[];
    // Both tokens must have used_at set.
    expect(rows.every((r) => r.used_at !== null)).toBe(true);
  });
});

// ── atomicity (HIGH 2) ───────────────────────────────────────────────────────

describe('atomicity (HIGH 2)', () => {
  it('leaves password unchanged and token not consumed when the email does not match', async () => {
    // The consume step finds no row (wrong email) → early ROLLBACK; the
    // password and token must be exactly as before.
    const raw = 'atomic-test';
    await savePasswordResetToken('u1', 'a@x.com', hashCode(raw), future());

    const result = await applyPasswordReset(hashCode(raw), 'wrong@x.com', hashPassword('newpass'));
    expect(result).toBeNull();

    // Password unchanged.
    const { password_hash } = memdb().public.one(
      "SELECT password_hash FROM users WHERE id = 'u1'"
    ) as { password_hash: string };
    expect(verifyPassword('oldpassword', password_hash)).toBe(true);

    // Token not consumed.
    const { used_at } = memdb().public.one(
      'SELECT used_at FROM password_reset_tokens'
    ) as { used_at: Date | null };
    expect(used_at).toBeNull();
  });
});
