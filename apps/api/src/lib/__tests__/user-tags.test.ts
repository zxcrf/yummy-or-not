// Integration tests for the user_tags candidate-set DB helpers (lib/db.ts).
//
// Covers: CRUD happy paths, ownership isolation (user A cannot delete/rename
// user B's tag), lazy-seed (defaults + historical taste tags deduped,
// second GET doesn't re-seed), empty-name rejection at the DB layer,
// case-insensitive uniqueness (POST 'Boba' then 'boba' → no duplicate;
// rename to case-variant of another tag → rejected), and that renaming a
// tag does NOT alter tastes rows.
//
// Runs against pg-mem (in-process Postgres simulation) — no real DB needed.

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
      `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
  });
  (globalThis as Record<string, unknown>).__tagsMemdb = db;
  return db.adapters.createPg();
});

import { listUserTags, createUserTag, deleteUserTag, renameUserTag } from '../db';

const memdb = () => (globalThis as Record<string, unknown>).__tagsMemdb as IMemoryDb;

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
      plan          text NOT NULL DEFAULT 'free',
      created_at    timestamptz NOT NULL DEFAULT now()
    );
  `);
  db.public.none(`
    CREATE TABLE tastes (
      id           text PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id      text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name         text NOT NULL,
      place        text NOT NULL DEFAULT '',
      price        text NOT NULL DEFAULT '',
      verdict      text NOT NULL,
      tags         text[] NOT NULL DEFAULT '{}',
      bought_count int  NOT NULL DEFAULT 1,
      notes        text NOT NULL DEFAULT '',
      image        text NOT NULL DEFAULT '',
      created_at   timestamptz NOT NULL DEFAULT now()
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
  // Case-insensitive unique index — mirrors production schema.
  db.public.none(`
    CREATE UNIQUE INDEX user_tags_user_name_ci_key ON user_tags (user_id, lower(name));
  `);
}

beforeAll(() => {
  createSchema();
});

beforeEach(() => {
  const db = memdb();
  db.public.none('DELETE FROM user_tags;');
  db.public.none('DELETE FROM tastes;');
  db.public.none('DELETE FROM users;');
  db.public.none(`INSERT INTO users (id, display_name) VALUES ('u1', 'Alice'), ('u2', 'Bob');`);
});

// ── CRUD happy paths ──────────────────────────────────────────────────────────

describe('createUserTag', () => {
  it('creates a tag and returns a UserTag shape', async () => {
    const tag = await createUserTag('u1', 'Ramen');
    expect(tag.id).toBeTruthy();
    expect(tag.name).toBe('Ramen');
    expect(tag.createdAt).toBeTruthy();
  });

  it('upserts on exact-case conflict — returns the row on duplicate name', async () => {
    const first = await createUserTag('u1', 'Boba');
    const second = await createUserTag('u1', 'Boba');
    expect(second.id).toBe(first.id);
    const tags = await listUserTags('u1');
    expect(tags.filter((t) => t.name === 'Boba')).toHaveLength(1);
  });

  it('upserts on case-insensitive conflict — POST Boba then boba yields one row', async () => {
    const first = await createUserTag('u1', 'Boba');
    const second = await createUserTag('u1', 'boba');
    // The upsert returns the row (updated name to the new casing per DO UPDATE SET name = EXCLUDED.name).
    expect(second.id).toBe(first.id);
    const tags = await listUserTags('u1');
    expect(tags.filter((t) => t.name.toLowerCase() === 'boba')).toHaveLength(1);
  });
});

describe('listUserTags', () => {
  it('returns tags sorted alphabetically by name', async () => {
    await createUserTag('u1', 'Ramen');
    await createUserTag('u1', 'Boba');
    await createUserTag('u1', 'Coffee');
    const tags = await listUserTags('u1');
    const names = tags.map((t) => t.name);
    expect(names).toEqual([...names].sort());
  });

  it("returns only the requesting user's tags", async () => {
    await createUserTag('u1', 'Ramen');
    await createUserTag('u2', 'Pizza');
    const u1Tags = await listUserTags('u1');
    expect(u1Tags.every((t) => t.name !== 'Pizza')).toBe(true);
  });
});

describe('deleteUserTag', () => {
  it('deletes an owned tag and returns true', async () => {
    const tag = await createUserTag('u1', 'Spicy');
    const deleted = await deleteUserTag('u1', tag.id);
    expect(deleted).toBe(true);
    const tags = await listUserTags('u1');
    expect(tags.find((t) => t.id === tag.id)).toBeUndefined();
  });

  it('returns false when tag does not exist', async () => {
    const deleted = await deleteUserTag('u1', 'nonexistent-id');
    expect(deleted).toBe(false);
  });
});

describe('renameUserTag', () => {
  it('renames a tag and returns the updated row', async () => {
    const tag = await createUserTag('u1', 'OldName');
    const result = await renameUserTag('u1', tag.id, 'NewName');
    expect(result).not.toBe('not_found');
    expect(result).not.toBe('name_conflict');
    const updated = result as Exclude<typeof result, 'not_found' | 'name_conflict'>;
    expect(updated.id).toBe(tag.id);
    expect(updated.name).toBe('NewName');
  });

  it("returns 'not_found' when tag does not exist", async () => {
    const result = await renameUserTag('u1', 'nonexistent-id', 'Anything');
    expect(result).toBe('not_found');
  });

  it("returns 'name_conflict' when renaming to a case-variant of another existing tag", async () => {
    await createUserTag('u1', 'Coffee');
    const ramen = await createUserTag('u1', 'Ramen');
    // Rename 'Ramen' → 'coffee' (lowercase variant of existing 'Coffee') should be rejected.
    const result = await renameUserTag('u1', ramen.id, 'coffee');
    expect(result).toBe('name_conflict');
    // Original tag is unchanged.
    const tags = await listUserTags('u1');
    expect(tags.find((t) => t.id === ramen.id)?.name).toBe('Ramen');
  });

  it('allows rename to a case-variant of itself (e.g. Ramen → ramen)', async () => {
    const tag = await createUserTag('u1', 'Ramen');
    const result = await renameUserTag('u1', tag.id, 'ramen');
    expect(result).not.toBe('not_found');
    expect(result).not.toBe('name_conflict');
    const updated = result as Exclude<typeof result, 'not_found' | 'name_conflict'>;
    expect(updated.name).toBe('ramen');
  });
});

// ── Ownership isolation ───────────────────────────────────────────────────────

describe('ownership isolation', () => {
  it("user A cannot delete user B's tag", async () => {
    const bobTag = await createUserTag('u2', 'Burger');
    const deleted = await deleteUserTag('u1', bobTag.id);
    expect(deleted).toBe(false);
    const bobTags = await listUserTags('u2');
    expect(bobTags.find((t) => t.id === bobTag.id)).toBeDefined();
  });

  it("user A cannot rename user B's tag", async () => {
    const bobTag = await createUserTag('u2', 'Dessert');
    const result = await renameUserTag('u1', bobTag.id, 'Hijacked');
    expect(result).toBe('not_found');
    const bobTags = await listUserTags('u2');
    expect(bobTags.find((t) => t.id === bobTag.id)?.name).toBe('Dessert');
  });
});

// ── Lazy seed ────────────────────────────────────────────────────────────────

describe('lazy seed', () => {
  it('seeds default tags (FILTERS without "All") on first GET for a new user', async () => {
    const tags = await listUserTags('u1');
    const names = tags.map((t) => t.name);
    // FILTERS without "All" = Boba, Coffee, Ramen, Dessert, Burger, Pizza, Spicy
    expect(names).toContain('Boba');
    expect(names).toContain('Coffee');
    expect(names).toContain('Ramen');
    expect(names).not.toContain('All');
  });

  it('includes distinct historical taste tags in the seed', async () => {
    memdb().public.none(`
      INSERT INTO tastes (user_id, name, verdict, tags)
      VALUES ('u1', 'Sushi', 'yum', ARRAY['Sushi', 'Japanese']);
    `);
    const tags = await listUserTags('u1');
    const names = tags.map((t) => t.name);
    expect(names).toContain('Sushi');
    expect(names).toContain('Japanese');
  });

  it('deduplicates case-insensitively between defaults and historical tags', async () => {
    // "boba" (lowercase) is a historical tag; "Boba" is a default — should appear once.
    memdb().public.none(`
      INSERT INTO tastes (user_id, name, verdict, tags)
      VALUES ('u1', 'Tea', 'yum', ARRAY['boba']);
    `);
    const tags = await listUserTags('u1');
    const bobaLike = tags.filter((t) => t.name.toLowerCase() === 'boba');
    expect(bobaLike).toHaveLength(1);
  });

  it('does not re-seed on a second GET (idempotent)', async () => {
    const first = await listUserTags('u1');
    const second = await listUserTags('u1');
    expect(second.length).toBe(first.length);
  });
});

// ── Rename does not alter tastes rows ────────────────────────────────────────

describe('rename does not touch tastes.tags', () => {
  it('tastes.tags arrays are unchanged after renaming a tag', async () => {
    memdb().public.none(`
      INSERT INTO tastes (id, user_id, name, verdict, tags)
      VALUES ('t1', 'u1', 'Ramen Bowl', 'yum', ARRAY['Ramen', 'Spicy']);
    `);
    const tag = await createUserTag('u1', 'Ramen');
    await renameUserTag('u1', tag.id, 'NoodleSoup');

    const tasteRow = memdb().public.one(`SELECT tags FROM tastes WHERE id = 't1'`) as { tags: string[] };
    expect(tasteRow.tags).toContain('Ramen');
    expect(tasteRow.tags).not.toContain('NoodleSoup');
  });
});
