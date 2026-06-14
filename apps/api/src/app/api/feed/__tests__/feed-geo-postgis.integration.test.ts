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
import { encodeGeohash } from '@yon/shared';

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
// TRUE precision-5 cells for the fixtures (the feeds filter on grid_cell, so the
// seed must use each point's real cell). NEAR and FAR are in DIFFERENT cells.
const NEAR_CELL = encodeGeohash(NEAR.lat, NEAR.lng, 5); // 'xn4z5'
const FAR_CELL = encodeGeohash(FAR.lat, FAR.lng, 5); // 'xn4z7'
// A second point ~111 m east of NEAR that shares NEAR's cell — the realistic
// "two precise points, one grid_cell" indistinguishability pair.
const NEAR2 = { lat: NEAR.lat, lng: NEAR.lng + 0.001 };

async function seed(): Promise<void> {
  await raw(`INSERT INTO users (id, display_name, plan) VALUES
    ('owner_a','Owner A','free'),
    ('owner_b','Owner B','free'),
    ('viewer','Viewer','free');`);
  // Three of owner_a/b's tastes WITH coords; one is left private (not published).
  // t_near carries the de-anonymizing fields (place + notes) AND the safe
  // enrichment fields (tags / bought_count / warn_before_buy) so the coarsening
  // test can prove the safe ones surface while place/notes never do.
  await raw(
    `INSERT INTO tastes (id, user_id, name, verdict, lat, lng, place, notes, tags, bought_count, warn_before_buy) VALUES
       ('t_near','owner_a','Near Ramen','yum',$1,$2,'123 Secret St, Apt 4','my place downtown',ARRAY['Ramen','Spicy'],4,true),
       ('t_far','owner_b','Far Sushi','meh',$3,$4,'','',ARRAY[]::text[],1,false),
       ('t_private','owner_a','Secret Spot','yum',$1,$2,'','',ARRAY[]::text[],1,false);`,
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
    //
    // grid_cell is each point's TRUE precision-5 geohash: NEAR → xn4z5, FAR (5.5 km
    // north) → xn4z7. The feeds now filter on grid_cell (not precise geog), so the
    // fixture must be cell-honest: a far point lives in a far cell. (NEAR_CELL and
    // FAR_CELL below are asserted against encodeGeohash so a precision regression
    // is caught.)
    await setTasteVisibility('owner_a', 't_near', [{ type: 'geo', lat: NEAR.lat, lng: NEAR.lng, gridCell: NEAR_CELL }]);
    await setTasteVisibility('owner_b', 't_far', [{ type: 'geo', lat: FAR.lat, lng: FAR.lng, gridCell: FAR_CELL }]);
  });

  it('the GiST index on geog exists (radius query is index-backed, not a seq scan)', async () => {
    const { rows } = await raw(
      `SELECT indexdef FROM pg_indexes WHERE tablename = 'taste_shares'`,
    );
    const defs = rows.map((r) => String(r['indexdef']).toLowerCase());
    expect(defs.some((s) => s.includes('gist') && s.includes('geog'))).toBe(true);
  });

  it('the radius feed returns cells INSIDE the radius and excludes cells outside it', async () => {
    // Cell-grain radius: the 300 m circle around ME covers cells [xn4z4, xn4z5]
    // → t_near (xn4z5) in, t_far (xn4z7, ~5.5 km) out. The 10 km circle covers
    // both cells → both in. Resolution is the cell, never the precise point.
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
    const cellRows = await listGeoFeedByCell(NEAR_CELL);
    expect(cellRows.map((c) => c.name)).not.toContain('Secret Spot');
    // The seed leaves only t_near published in xn4z5. Add two MORE published
    // shares in the SAME cell (different precise coords) so it clears the
    // k-anonymity floor (HEAT_MIN_COUNT=3) and a bucket actually surfaces. The
    // private row at NEAR's coords is still never counted: a count of exactly 3
    // proves the published rows aggregated, the private row is invisible.
    await raw(
      `INSERT INTO tastes (id, user_id, name, verdict, lat, lng) VALUES
         ('t_pair2','owner_b','Pair Bar','yum',$1,$2),
         ('t_third','owner_b','Third Bar','yum',$3,$4);`,
      [NEAR2.lat, NEAR2.lng, NEAR.lat, NEAR.lng],
    );
    await setTasteVisibility('owner_b', 't_pair2', [{ type: 'geo', lat: NEAR2.lat, lng: NEAR2.lng, gridCell: NEAR_CELL }]);
    await setTasteVisibility('owner_b', 't_third', [{ type: 'geo', lat: NEAR.lat, lng: NEAR.lng, gridCell: NEAR_CELL }]);
    const heat = await geoHeat({ minLng: 138.9, minLat: 34.9, maxLng: 139.2, maxLat: 35.1 });
    const cell = heat.find((h) => h.cell === NEAR_CELL);
    expect(cell).toBeDefined();
    // 3 published shares (t_near, t_pair2, t_third) in the cell — NOT 4. The
    // private t_private row at NEAR's coords is excluded by the visibility filter.
    expect(Number(cell!.count)).toBe(3);
  });

  it('the radius response is COARSENED — no precise coords / owner identity leak', async () => {
    const rows = await listGeoFeedNear({ lat: ME.lat, lng: ME.lng, radiusM: 10_000 });
    expect(rows.length).toBeGreaterThan(0);
    for (const card of rows) {
      // Coarsened cell is allowed; precise coords + identity + free text are not.
      expect(card).toHaveProperty('gridCell');
      for (const k of ['lat', 'lng', 'latitude', 'longitude', 'userId', 'user_id', 'ownerId', 'owner_id', 'place', 'address', 'notes']) {
        expect(card).not.toHaveProperty(k);
      }
    }
  });

  it('surfaces SAFE enrichment fields (tags / boughtCount / warnBeforeBuy) — never place/notes', async () => {
    // t_near was seeded with place + notes (de-anonymizing) AND tags/bought/warn
    // (safe). Prove the SELECT lets the safe ones through and drops place/notes,
    // so adding columns to GEO_FEED_COLUMNS never re-opens a leak.
    const rows = await listGeoFeedByCell(NEAR_CELL);
    const near = rows.find((c) => c.name === 'Near Ramen');
    expect(near).toBeDefined();
    expect(near!.tags).toEqual(['Ramen', 'Spicy']);
    expect(near!.boughtCount).toBe(4);
    expect(near!.warnBeforeBuy).toBe(true);
    expect(near).not.toHaveProperty('place');
    expect(near).not.toHaveProperty('notes');
  });

  // ── PRIVACY: precise-coord leak via filter inference is CLOSED ─────────────
  // The bug: near/heat filtered on the precise `ts.geog`. Even with a coarsened
  // response, an attacker could shrink the radius/bbox to ~1 m and binary-search
  // whether a share's exact point falls inside → recover precise coordinates.
  // The fix quantizes every query to geohash-5 cells (grid_cell = ANY(cells)), so
  // the finest resolution any query yields is one cell. These pin that closure:
  // two shares with DIFFERENT precise coords but the SAME grid_cell must be
  // INDISTINGUISHABLE across all near/heat queries, and a sub-cell query cannot
  // isolate one.
  describe('NEGATIVE: a sub-cell query cannot recover precise coordinates', () => {
    // The indistinguishability pair: t_near at NEAR and t_pair2 at NEAR2 (~111 m
    // east). Their precise coords DIFFER, but both genuinely encode to NEAR_CELL
    // (xn4z5). t_third (also in the cell) lifts the cell over the k-anonymity
    // floor so heat buckets actually surface. All seeded locally per-test.
    beforeEach(async () => {
      await raw(
        `INSERT INTO tastes (id, user_id, name, verdict, lat, lng) VALUES
           ('t_pair2','owner_b','Pair Bar','yum',$1,$2),
           ('t_third','owner_b','Third Bar','yum',$3,$4);`,
        [NEAR2.lat, NEAR2.lng, NEAR.lat, NEAR.lng],
      );
      await setTasteVisibility('owner_b', 't_pair2', [{ type: 'geo', lat: NEAR2.lat, lng: NEAR2.lng, gridCell: NEAR_CELL }]);
      await setTasteVisibility('owner_b', 't_third', [{ type: 'geo', lat: NEAR.lat, lng: NEAR.lng, gridCell: NEAR_CELL }]);
    });

    it('near: a 1 m radius on EITHER precise point returns the SAME same-cell members', async () => {
      // Attacker centres a 1 m radius exactly on t_near's point, then on t_pair2's
      // ~111 m away. Under the OLD ST_DWithin each returned only its own row
      // (precise) — the oracle. Under the quantized filter BOTH queries resolve to
      // the same cell and return the SAME members: the attacker cannot tell which
      // precise point any row sits at.
      const onNear = (await listGeoFeedNear({ lat: NEAR.lat, lng: NEAR.lng, radiusM: 1 })).map((c) => c.id).sort();
      const onPair = (await listGeoFeedNear({ lat: NEAR2.lat, lng: NEAR2.lng, radiusM: 1 })).map((c) => c.id).sort();
      expect(onNear).toEqual(onPair);
      expect(onNear).toContain('t_near');
      expect(onNear).toContain('t_pair2');
    });

    it('near: shifting the tiny-radius center anywhere inside the cell yields the IDENTICAL result set', async () => {
      // Sweep the query center across the cell at sub-cell offsets. Every query
      // must return the SAME membership — there is no center that isolates one
      // share, which is exactly what defeats the binary search.
      const at = (lat: number, lng: number) =>
        listGeoFeedNear({ lat, lng, radiusM: 1 }).then((r) => r.map((c) => c.id).sort());
      const a = await at(NEAR.lat, NEAR.lng);
      const b = await at(NEAR.lat + 0.0005, NEAR.lng + 0.0005);
      const c = await at(NEAR.lat - 0.0005, NEAR.lng - 0.0005);
      expect(b).toEqual(a);
      expect(c).toEqual(a);
      expect(a).toContain('t_near');
      expect(a).toContain('t_pair2');
    });

    it('heat: a 1 m bbox around one point yields the SAME bucket as a 1 m bbox around the OTHER point', async () => {
      // The decisive heat oracle test: the two bboxes are centred on DIFFERENT
      // precise points (NEAR vs NEAR2). Both live in NEAR_CELL, so each sub-cell
      // bbox resolves to that one cell → the IDENTICAL bucket. The attacker learns
      // only "cell xn4z5 has N shares", never which precise point any of them is at.
      const eps = 0.000005;
      const aroundNear = await geoHeat({
        minLng: NEAR.lng - eps, minLat: NEAR.lat - eps, maxLng: NEAR.lng + eps, maxLat: NEAR.lat + eps,
      });
      const aroundPair = await geoHeat({
        minLng: NEAR2.lng - eps, minLat: NEAR2.lat - eps, maxLng: NEAR2.lng + eps, maxLat: NEAR2.lat + eps,
      });
      expect(aroundNear).toEqual(aroundPair);
      const bucket = aroundNear.find((h) => h.cell === NEAR_CELL);
      expect(bucket).toBeDefined();
      // t_near + t_pair2 + t_third = 3 published shares in the cell.
      expect(Number(bucket!.count)).toBe(3);
    });
  });

  it('heat: a cell with fewer than 3 shares is SUPPRESSED (k-anonymity)', async () => {
    // The default seed puts exactly 1 published share in xn4z5 (t_near; t_far is
    // in xn4z7) and 1 in xn4z7. Both are below the HEAT_MIN_COUNT=3 floor → NO
    // bucket may surface, so a count of 1 or 2 never pinpoints a near-single
    // person.
    const heat = await geoHeat({ minLng: 138.9, minLat: 34.9, maxLng: 139.2, maxLat: 35.1 });
    expect(heat.find((h) => h.cell === NEAR_CELL)).toBeUndefined();
    expect(heat.find((h) => h.cell === FAR_CELL)).toBeUndefined();
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
