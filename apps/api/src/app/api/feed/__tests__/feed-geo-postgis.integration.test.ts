// REAL PostGIS integration test for S3c — the radius feed end-to-end.
//
// This is the test the plan calls out as load-bearing and impossible to fake:
//   §S3c verification: "PostGIS `ST_DWithin` 半径查询正确性（含 GiST 索引命中）"
//   + "private 记录任何 feed 旁路不可读（负向）"
//   + "geo feed 不暴露精确坐标/身份（半径结果粗化到 cell）".
//
// pg-mem CANNOT run PostGIS (no geography type, no ST_DWithin), so this runs
// against a real postgis/postgis container. It is GATED on DATABASE_URL_POSTGIS
// so CI without the container skips cleanly — but where the container is up
// (local dev / this branch) it RUNS for real: applies the full migration chain
// (schema.sql baseline + 0009a CREATE EXTENSION postgis + 0009 taste_shares),
// seeds rows, and asserts the actual db helper behaviour.
//
// To run locally:
//   DATABASE_URL_POSTGIS=postgresql://yon:yon@127.0.0.1:55432/yon_test \
//     pnpm --filter api test -- --testPathPattern=feed-geo-postgis
//
// FAILS today (when the container IS present): migrations 0009a/0009 and the db
// helpers (setTasteVisibility / listGeoFeedNear / listGeoFeedByCell / geoHeat)
// do not exist yet, so applyChain() throws / the helper import is undefined.
// PASSES once S3c ships them.

import path from 'path';
import { readFileSync, readdirSync } from 'fs';

const POSTGIS_URL = process.env.DATABASE_URL_POSTGIS;
const d = POSTGIS_URL ? describe : describe.skip;

// __tests__ → feed → api → app → src → apps/api
const ROOT = path.resolve(__dirname, '../../../../../');
const MIGRATIONS_DIR = path.join(ROOT, 'db', 'migrations');
const SCHEMA = path.join(ROOT, 'db', 'schema.sql');

// db.ts reads process.env.DATABASE_URL at import time to build its Pool, so we
// point it at the container BEFORE importing the helpers (dynamic import below).
if (POSTGIS_URL) process.env.DATABASE_URL = POSTGIS_URL;

/** Run an arbitrary SQL string against the container via a one-off pg.Client. */
async function raw(query: string, params: unknown[] = []): Promise<{ rows: Record<string, unknown>[] }> {
  const { Client } = await import('pg');
  const client = new Client({ connectionString: POSTGIS_URL });
  await client.connect();
  try {
    return (await client.query(query, params as never[])) as { rows: Record<string, unknown>[] };
  } finally {
    await client.end();
  }
}

/** Apply a clean baseline (schema.sql) then the S3c migrations 0009a + 0009 in
 *  lexical order. We drop the whole public schema first for a DETERMINISTIC,
 *  reproducible baseline — schema.sql's top-of-file DROP list is partial (it does
 *  not drop later-added tables), so re-running it on a dirty DB errors. A fresh
 *  schema makes this test self-contained against any container state. */
async function applyChain(): Promise<void> {
  // Clean slate. DROP SCHEMA also drops the postgis extension, so the very first
  // thing the chain must do is (re)create it — exactly what migration 0009a is
  // for. We apply the 0009* files so that whichever one runs CREATE EXTENSION
  // runs BEFORE the geography column (sorted, but the extension file hoisted
  // first to mirror the prerequisite-before-table contract the shape test pins).
  await raw('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await raw(readFileSync(SCHEMA, 'utf8'));

  const s3cFiles = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql') && f.startsWith('0009'))
    .sort();
  if (s3cFiles.length === 0) {
    throw new Error('S3c migrations 0009/0009a not found — cannot run the PostGIS integration test (RED until S3c ships them).');
  }
  const body = (f: string) => readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8');
  const isExt = (f: string) => /create\s+extension\s+if\s+not\s+exists\s+postgis/i.test(body(f));
  // Extension file(s) first, then the rest in lexical order — the apply order the
  // real runner achieves once the prerequisite is named to sort first.
  const ordered = [...s3cFiles.filter(isExt), ...s3cFiles.filter((f) => !isExt(f))];
  for (const f of ordered) {
    // eslint-disable-next-line no-await-in-loop
    await raw(body(f));
  }
}

// Tokyo-centred fixtures. viewer queries from (35.0, 139.0).
const ME = { lat: 35.0, lng: 139.0 };
// near: ~111 m north — inside a 300 m radius.
const NEAR = { lat: 35.001, lng: 139.0 };
// far: ~5.5 km north — outside 300 m, inside 10 km.
const FAR = { lat: 35.05, lng: 139.0 };

async function seed(): Promise<void> {
  await raw(`INSERT INTO users (id, display_name, plan) VALUES
    ('owner_a','Owner A','free'),
    ('owner_b','Owner B','free'),
    ('viewer','Viewer','free');`);
  // Three of owner_a/b's tastes WITH coords; one is left private (not published).
  await raw(
    `INSERT INTO tastes (id, user_id, name, verdict, lat, lng) VALUES
       ('t_near','owner_a','Near Ramen','yum',$1,$2),
       ('t_far','owner_b','Far Sushi','meh',$3,$4),
       ('t_private','owner_a','Secret Spot','yum',$1,$2);`,
    [NEAR.lat, NEAR.lng, FAR.lat, FAR.lng],
  );
}

d('PostGIS geo feed — ST_DWithin radius, coarsening, private-row exclusion', () => {
  // Helpers imported dynamically AFTER DATABASE_URL is pointed at the container.
  let setTasteVisibility: (uid: string, id: string, targets: unknown[]) => Promise<unknown>;
  let listGeoFeedNear: (q: { lat: number; lng: number; radiusM: number }) => Promise<Array<Record<string, unknown>>>;
  let listGeoFeedByCell: (cell: string) => Promise<Array<Record<string, unknown>>>;
  let geoHeat: (bbox: { minLng: number; minLat: number; maxLng: number; maxLat: number }) => Promise<Array<{ cell: string; count: number }>>;
  let listFamilyFeed: (q: { viewerId: string; member?: string }) => Promise<Array<Record<string, unknown>>>;

  beforeAll(async () => {
    await applyChain();
    const db = await import('@/lib/db');
    setTasteVisibility = (db as unknown as { setTasteVisibility: typeof setTasteVisibility }).setTasteVisibility;
    listGeoFeedNear = (db as unknown as { listGeoFeedNear: typeof listGeoFeedNear }).listGeoFeedNear;
    listGeoFeedByCell = (db as unknown as { listGeoFeedByCell: typeof listGeoFeedByCell }).listGeoFeedByCell;
    geoHeat = (db as unknown as { geoHeat: typeof geoHeat }).geoHeat;
    listFamilyFeed = (db as unknown as { listFamilyFeed: typeof listFamilyFeed }).listFamilyFeed;
  }, 60_000);

  afterAll(async () => {
    // db.ts opens a module-level Pool on globalThis.__pgPool; close it so jest
    // exits cleanly (avoids the documented Linux "all pass, exit 1" async-leak —
    // see docs/engineering/jest-async-leaks.md).
    const g = globalThis as Record<string, unknown>;
    const pool = g['__pgPool'] as { end?: () => Promise<void> } | undefined;
    if (pool?.end) await pool.end();
  });

  beforeEach(async () => {
    await raw('DELETE FROM taste_shares;');
    await raw('DELETE FROM tastes;');
    await raw('DELETE FROM users;');
    await seed();
    // Publish the two non-secret tastes to geo (double-write geog + grid_cell).
    // t_private is deliberately NEVER published — it stays visibility='private'.
    await setTasteVisibility('owner_a', 't_near', [{ type: 'geo', lat: NEAR.lat, lng: NEAR.lng, gridCell: 'xn4z5' }]);
    await setTasteVisibility('owner_b', 't_far', [{ type: 'geo', lat: FAR.lat, lng: FAR.lng, gridCell: 'xn4z5' }]);
  });

  it('the GiST index on geog exists (radius query is index-backed, not a seq scan)', async () => {
    const { rows } = await raw(
      `SELECT indexdef FROM pg_indexes WHERE tablename = 'taste_shares'`,
    );
    const defs = rows.map((r) => String(r['indexdef']).toLowerCase());
    expect(defs.some((s) => s.includes('gist') && s.includes('geog'))).toBe(true);
  });

  it('ST_DWithin returns rows INSIDE the radius and excludes rows outside it', async () => {
    // 300 m radius: t_near (~111 m) in, t_far (~5.5 km) out.
    const tight = await listGeoFeedNear({ lat: ME.lat, lng: ME.lng, radiusM: 300 });
    const names = tight.map((c) => c.name);
    expect(names).toContain('Near Ramen');
    expect(names).not.toContain('Far Sushi');

    // 10 km radius: both published rows in.
    const wide = await listGeoFeedNear({ lat: ME.lat, lng: ME.lng, radiusM: 10_000 });
    const wideNames = wide.map((c) => c.name);
    expect(wideNames).toContain('Near Ramen');
    expect(wideNames).toContain('Far Sushi');
  });

  it('NEGATIVE: a private (unpublished) taste is unreadable via the radius feed', async () => {
    // t_private sits at the SAME coords as t_near, well inside the radius — the
    // ONLY reason it must not appear is that it was never published. This is the
    // core bypass-proof: visibility filtering, not distance, hides it.
    const rows = await listGeoFeedNear({ lat: ME.lat, lng: ME.lng, radiusM: 300 });
    expect(rows.map((c) => c.name)).not.toContain('Secret Spot');
    expect(rows.map((c) => c.id)).not.toContain('t_private');
  });

  it('NEGATIVE: a private taste is unreadable via the cell feed and absent from heat counts', async () => {
    const cellRows = await listGeoFeedByCell('xn4z5');
    expect(cellRows.map((c) => c.name)).not.toContain('Secret Spot');
    // Heat counts only the 2 published shares in the cell, never the private row.
    const heat = await geoHeat({ minLng: 138.9, minLat: 34.9, maxLng: 139.2, maxLat: 35.1 });
    const xn4z5 = heat.find((h) => h.cell === 'xn4z5');
    expect(xn4z5).toBeDefined();
    expect(Number(xn4z5!.count)).toBe(2);
  });

  it('the radius response is COARSENED — no precise coords / owner identity leak', async () => {
    const rows = await listGeoFeedNear({ lat: ME.lat, lng: ME.lng, radiusM: 10_000 });
    expect(rows.length).toBeGreaterThan(0);
    for (const card of rows) {
      // Coarsened cell is allowed; precise coords + identity are not.
      expect(card).toHaveProperty('gridCell');
      for (const k of ['lat', 'lng', 'latitude', 'longitude', 'userId', 'user_id', 'ownerId', 'owner_id', 'place', 'address']) {
        expect(card).not.toHaveProperty(k);
      }
    }
  });

  // ── Family/member feed viewer scoping (IDOR boundary) ──────────────────────
  // Plan §S3c: "family/member feed 均不得泄漏". listFamilyFeed must bind to the
  // CALLER (ts.owner_id = viewerId). Before the fix it had no owner/viewer
  // predicate, so any authenticated user read every owner's family/member shares.
  describe('NEGATIVE: family/member feed cannot cross tenants', () => {
    beforeEach(async () => {
      // owner_a publishes a family-targeted share of t_private to their OWN taster.
      // (target_id is owner_a's persona; the row's owner_id is owner_a.)
      await raw('DELETE FROM taste_shares;');
      await raw(
        `INSERT INTO taste_shares (taste_id, owner_id, target_type, target_id)
         VALUES ('t_private','owner_a','member','ts_owner_a_persona');`,
      );
      await raw(`UPDATE tastes SET visibility = 'shared' WHERE id = 't_private';`);
    });

    it("owner_b does NOT see owner_a's family/member-shared taste — no owner predicate would leak it", async () => {
      // The decisive test: the share IS published & 'shared', and owner_b guesses
      // owner_a's member id. The ONLY thing that must hide it is the owner-scoping
      // predicate. Without `ts.owner_id = viewerId` owner_b reads owner_a's row.
      const asOwnerB = await listFamilyFeed({ viewerId: 'owner_b', member: 'ts_owner_a_persona' });
      expect(asOwnerB.map((c) => c.id)).not.toContain('t_private');

      // And with no member filter at all, owner_b still sees none of owner_a's rows.
      const asOwnerBAll = await listFamilyFeed({ viewerId: 'owner_b' });
      expect(asOwnerBAll.map((c) => c.id)).not.toContain('t_private');
    });

    it('owner_a (the publisher) DOES see their own family/member-shared taste', async () => {
      // Positive control: the owner-scoping predicate must not over-restrict — the
      // legitimate reader (the owner who published) still gets their own row.
      const asOwnerA = await listFamilyFeed({ viewerId: 'owner_a' });
      expect(asOwnerA.map((c) => c.id)).toContain('t_private');
    });
  });

  // ── taste_shares geo consistency CHECK (migration 0009) ────────────────────
  describe('NEGATIVE: a geo share cannot be persisted with a null geog or grid_cell', () => {
    it('rejects a geo row missing geog (CHECK taste_shares_geo_complete)', async () => {
      await expect(
        raw(
          `INSERT INTO taste_shares (taste_id, owner_id, target_type, grid_cell)
           VALUES ('t_near','owner_a','geo','xn4z5');`,
        ),
      ).rejects.toThrow();
    });

    it('rejects a geo row missing grid_cell (CHECK taste_shares_geo_complete)', async () => {
      await expect(
        raw(
          `INSERT INTO taste_shares (taste_id, owner_id, target_type, geog)
           VALUES ('t_near','owner_a','geo', ST_SetSRID(ST_MakePoint(139.0, 35.0), 4326)::geography);`,
        ),
      ).rejects.toThrow();
    });
  });
});
