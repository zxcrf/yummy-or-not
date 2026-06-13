// Unit tests for the S3a share data layer (share-db.ts), pinning the review
// 翻修 fixes that the route-level tests (which mock share-db) cannot reach:
//
//   1. createShareToken STORES the derived import_code (so resolve is indexed).
//   2. resolveImportCode is an O(1) INDEXED lookup (import_code = $1), NOT a
//      full scan that re-derives the code per live token.
//   3. importSharedTaste re-checks revoked/expired INSIDE the transaction with
//      SELECT ... FOR UPDATE (TOCTOU guard); a token revoked after the route
//      gate but before commit rolls back and returns null.
//   4. A copied photo is COPIED INSIDE the transaction and CLEANED UP (deleted)
//      on any rollback (revoke race / concurrent-import race) so a failed
//      import never orphans an R2 object.
//
// The pg Pool is faked via globalThis.__pgPool; storage + db are mocked.

import { importCodeFor } from '../share-token';
import { isVariantKey } from '../image-variants';

// ── storage + db mocks ───────────────────────────────────────────────────────
const mockCopyPhoto = jest.fn();
const mockDeletePhoto = jest.fn();
jest.mock('../storage', () => ({
  copyPhoto: (...a: unknown[]) => mockCopyPhoto(...a),
  deletePhoto: (...a: unknown[]) => mockDeletePhoto(...a),
}));

const mockGetTaste = jest.fn();
const mockGetRawImage = jest.fn();
jest.mock('../db', () => ({
  getTaste: (...a: unknown[]) => mockGetTaste(...a),
  getRawImage: (...a: unknown[]) => mockGetRawImage(...a),
}));

import {
  createShareToken,
  resolveImportCode,
  importSharedTaste,
} from '../share-db';

// ── fake pool ────────────────────────────────────────────────────────────────
// poolQuery handles top-level pool().query(...) calls; clientQuery handles the
// transactional client (BEGIN/SELECT FOR UPDATE/INSERT/COMMIT/ROLLBACK). Both
// dispatch on the SQL text so a test can script row results per statement.
type QueryFn = (sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount?: number }>;

let poolQuery: jest.Mock;
let clientQuery: jest.Mock;
let clientReleased: boolean;

function installPool(poolImpl: QueryFn, clientImpl: QueryFn) {
  poolQuery = jest.fn(poolImpl);
  clientQuery = jest.fn(clientImpl);
  clientReleased = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).__pgPool = {
    query: (sql: string, params?: unknown[]) => poolQuery(sql, params),
    connect: async () => ({
      query: (sql: string, params?: unknown[]) => clientQuery(sql, params),
      release: () => { clientReleased = true; },
    }),
  };
}

afterEach(() => {
  jest.clearAllMocks();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (globalThis as any).__pgPool;
});

// ── 1. createShareToken stores the derived import_code ────────────────────────

describe('createShareToken — stores the derived import code', () => {
  it('INSERTs import_code = importCodeFor(token) so resolve can be indexed', async () => {
    let insertedToken = '';
    let insertedImportCode: unknown = null;
    installPool(
      async (sql, params) => {
        expect(sql).toMatch(/INSERT INTO share_tokens/);
        expect(sql).toMatch(/import_code/);
        const p = params as unknown[];
        insertedToken = p[0] as string;
        insertedImportCode = p[3];
        return {
          rows: [{
            token: p[0], taste_id: p[1], owner_id: p[2],
            revoked: false, expires_at: null,
          }],
        };
      },
      async () => ({ rows: [] }),
    );

    await createShareToken({ tasteId: 't1', ownerId: 'o1' });

    // The stored code is exactly the deterministic derivation of the token.
    expect(insertedImportCode).toBe(importCodeFor(insertedToken));
    expect(typeof insertedImportCode).toBe('string');
  });
});

// ── 2. resolveImportCode is an indexed lookup, not a full scan ────────────────

describe('resolveImportCode — indexed lookup (no full scan)', () => {
  it('queries WHERE import_code = $1 (parameterized) and returns the token', async () => {
    installPool(
      async (sql, params) => {
        // The fix: a single indexed lookup keyed on the stored code, scoped to
        // live tokens. The OLD code selected ALL live tokens (no WHERE on the
        // code, no parameter) and re-derived per row — that must NOT happen.
        expect(sql).toMatch(/WHERE\s+import_code\s*=\s*\$1/);
        expect(params).toEqual(['ABC123']);
        return { rows: [{ token: 'tok_live' }] };
      },
      async () => ({ rows: [] }),
    );

    const token = await resolveImportCode('ABC123');
    expect(token).toBe('tok_live');
    // Exactly one DB round-trip — not a scan + per-row hashing loop.
    expect(poolQuery).toHaveBeenCalledTimes(1);
  });

  it('returns null when no live token carries the code', async () => {
    installPool(async () => ({ rows: [] }), async () => ({ rows: [] }));
    expect(await resolveImportCode('NOPE12')).toBeNull();
  });
});

// ── 3 + 4. importSharedTaste — TOCTOU re-check + orphan cleanup ────────────────

const SOURCE = {
  id: 'src', name: 'Boba', place: 'P', price: '1', tags: ['x'], notes: 'n',
};

describe('importSharedTaste — TOCTOU revocation re-check inside the txn', () => {
  it('rolls back and returns null (no copy persisted) when the token is revoked at FOR UPDATE time', async () => {
    // Pointer fetch (pre-txn) sees a LIVE token, but the FOR UPDATE lock inside
    // the transaction reveals it was revoked between the route gate and commit.
    mockGetTaste.mockResolvedValue(SOURCE);
    mockGetRawImage.mockResolvedValue('o1/t/k/orig.jpg'); // a copyable variant key
    mockCopyPhoto.mockResolvedValue('imp/t/new/orig.jpg');

    installPool(
      async (sql) => {
        if (/SELECT \* FROM share_tokens/.test(sql)) {
          return { rows: [{ token: 'tok', taste_id: 'src', owner_id: 'o1', revoked: false, expires_at: null }] };
        }
        if (/FROM taste_imports WHERE from_token/.test(sql)) {
          return { rows: [] }; // no prior import
        }
        return { rows: [] };
      },
      async (sql) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') return { rows: [] };
        if (/FOR UPDATE/.test(sql)) {
          // Revoked NOW (the race we are guarding against).
          return { rows: [{ revoked: true, expires_at: null }] };
        }
        throw new Error(`unexpected client query after revoke re-check: ${sql}`);
      },
    );

    const res = await importSharedTaste({ token: 'tok', importerId: 'imp' });
    expect(res).toBeNull();

    // The transaction rolled back; no taste/provenance INSERT ran. Crucially,
    // the copy must NOT have been persisted: copyPhoto runs only AFTER the
    // FOR UPDATE re-check passes, so a revoked token copies nothing.
    expect(mockCopyPhoto).not.toHaveBeenCalled();
    expect(clientQuery).toHaveBeenCalledWith('ROLLBACK', undefined);
    expect(clientReleased).toBe(true);
  });

  it('on the concurrent-import race (provenance conflict) it ROLLBACKs and DELETES the orphaned copy', async () => {
    mockGetTaste
      .mockResolvedValueOnce(SOURCE)            // live source read (pre-txn)
      .mockResolvedValueOnce({ id: 'winner-copy' }); // winner's existing copy
    mockGetRawImage.mockResolvedValue('o1/t/k/orig.jpg');
    mockCopyPhoto.mockResolvedValue('imp/t/new/orig.jpg'); // the copied (to-be-orphaned) key

    installPool(
      async (sql) => {
        if (/SELECT \* FROM share_tokens/.test(sql)) {
          return { rows: [{ token: 'tok', taste_id: 'src', owner_id: 'o1', revoked: false, expires_at: null }] };
        }
        if (/FROM taste_imports WHERE from_token/.test(sql)) {
          // First (pre-txn) call: no prior import. After the rollback, the
          // winner's row exists.
          return { rows: poolQuery.mock.calls.filter((c) => /taste_imports WHERE from_token/.test(c[0])).length > 1
            ? [{ taste_id: 'winner-copy' }]
            : [] };
        }
        return { rows: [] };
      },
      async (sql) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') return { rows: [] };
        if (/FOR UPDATE/.test(sql)) return { rows: [{ revoked: false, expires_at: null }] };
        if (/INSERT INTO tastes/.test(sql)) return { rows: [{ id: 'my-copy' }] };
        if (/INSERT INTO taste_imports/.test(sql)) return { rows: [] }; // ON CONFLICT DO NOTHING → lost the race
        throw new Error(`unexpected client query: ${sql}`);
      },
    );

    const res = await importSharedTaste({ token: 'tok', importerId: 'imp' });

    // We copied the photo inside the txn, then lost the provenance race → the
    // copy is orphaned and MUST be deleted (variant keys → all 3 variants).
    expect(mockCopyPhoto).toHaveBeenCalledTimes(1);
    expect(mockDeletePhoto).toHaveBeenCalled();
    expect(clientQuery).toHaveBeenCalledWith('ROLLBACK', undefined);
    // The winner's existing copy is returned as the idempotent result.
    expect(res).toEqual({ created: false, taste: { id: 'winner-copy' } });
  });

  it('happy path: FOR UPDATE passes → copy + inserts commit, returns created:true', async () => {
    mockGetTaste
      .mockResolvedValueOnce(SOURCE)                 // live source read
      .mockResolvedValueOnce({ id: 'my-copy', status: 'todo', verdict: null }); // final read of the copy
    mockGetRawImage.mockResolvedValue('o1/t/k/orig.jpg');
    mockCopyPhoto.mockResolvedValue('imp/t/new/orig.jpg');

    installPool(
      async (sql) => {
        if (/SELECT \* FROM share_tokens/.test(sql)) {
          return { rows: [{ token: 'tok', taste_id: 'src', owner_id: 'o1', revoked: false, expires_at: null }] };
        }
        if (/FROM taste_imports WHERE from_token/.test(sql)) return { rows: [] };
        return { rows: [] };
      },
      async (sql) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
        if (/FOR UPDATE/.test(sql)) return { rows: [{ revoked: false, expires_at: null }] };
        if (/INSERT INTO tastes/.test(sql)) return { rows: [{ id: 'my-copy' }] };
        if (/INSERT INTO taste_imports/.test(sql)) return { rows: [{ taste_id: 'my-copy' }] };
        throw new Error(`unexpected client query: ${sql}`);
      },
    );

    const res = await importSharedTaste({ token: 'tok', importerId: 'imp' });
    expect(res).toEqual({ created: true, taste: { id: 'my-copy', status: 'todo', verdict: null } });
    expect(mockCopyPhoto).toHaveBeenCalledTimes(1);
    expect(mockDeletePhoto).not.toHaveBeenCalled(); // nothing orphaned on success
    expect(clientQuery).toHaveBeenCalledWith('COMMIT', undefined);
  });
});

// ── 5. copy-on-import persists a CANONICAL variant key (resolver-visible) ──────
//
// Regression (review of 102d010): copySourcePhoto built the copy's orig key as
// `${importerId}/t/{uuid}/orig.{ext}`. That importer-prefixed key fails
// isVariantKey (anchored /^t\/…/), so resolvePhotoUrls treats the imported copy
// as a flat legacy key and serves the full-res ORIGINAL on list/detail — never
// the thumb/display variants copySourcePhoto already wrote. The copy's stored
// `image` MUST be a canonical variant key so the resolver emits the variants.
describe('importSharedTaste — copies a CANONICAL variant key into the copy', () => {
  it('persists an image key that isVariantKey accepts (resolver serves thumb/display, not orig)', async () => {
    mockGetTaste
      .mockResolvedValueOnce(SOURCE)                                       // live source read
      .mockResolvedValueOnce({ id: 'my-copy', status: 'todo', verdict: null }); // final read of the copy
    // A canonical owner variant key is the source of the copy-on-import.
    mockGetRawImage.mockResolvedValue('t/123e4567-e89b-12d3-a456-426614174000/orig.jpg');
    // copyPhoto echoes its destination so the REAL copySourcePhoto layout flows
    // through to the INSERT unaltered (no stubbed key hiding the bug).
    mockCopyPhoto.mockImplementation(async (_src: string, dst: string) => dst);

    let insertedImageKey = '';
    installPool(
      async (sql) => {
        if (/SELECT \* FROM share_tokens/.test(sql)) {
          return { rows: [{ token: 'tok', taste_id: 'src', owner_id: 'o1', revoked: false, expires_at: null }] };
        }
        if (/FROM taste_imports WHERE from_token/.test(sql)) return { rows: [] };
        return { rows: [] };
      },
      async (sql, params) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
        if (/FOR UPDATE/.test(sql)) return { rows: [{ revoked: false, expires_at: null }] };
        if (/INSERT INTO tastes/.test(sql)) {
          // The 7th INSERT param is the copy's stored `image` value.
          insertedImageKey = (params as unknown[])[6] as string;
          return { rows: [{ id: 'my-copy' }] };
        }
        if (/INSERT INTO taste_imports/.test(sql)) return { rows: [{ taste_id: 'my-copy' }] };
        throw new Error(`unexpected client query: ${sql}`);
      },
    );

    const res = await importSharedTaste({ token: 'tok', importerId: 'imp' });
    expect(res).toEqual({ created: true, taste: { id: 'my-copy', status: 'todo', verdict: null } });

    // The persisted key must be a canonical variant key the resolver understands,
    // and must NOT be the owner's source key (copy-on-import stays decoupled).
    expect(insertedImageKey).not.toBe('t/123e4567-e89b-12d3-a456-426614174000/orig.jpg');
    expect(isVariantKey(insertedImageKey)).toBe(true);
  });
});
