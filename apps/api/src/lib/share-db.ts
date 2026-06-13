// S3a share/import data layer — thin-pointer share_tokens + copy-on-import.
//
// Re-exported through db.ts so route handlers import the share helpers from
// '@/lib/db' alongside getTaste/getRawImage (the route-test harness mocks them
// there). Reuses the same pg Pool singleton as db.ts via globalThis.__pgPool.
//
// Security invariants (server-side, never trust the client):
//   - createShareToken is owner-gated by the ROUTE (getTaste(user.id, id)) before
//     it is called — the row records ownerId so revoke/preview stay owner-scoped.
//   - getShareToken returns the raw pointer row; the ROUTE decides 410 from
//     revoked / expired / source-deleted. Revocation flips `revoked` so the next
//     preview mints no presign (immediate effect).
//   - importSharedTaste copies the photo into the IMPORTER's namespace at import
//     time, so the copy is decoupled from the source (source edit/delete/revoke
//     cannot touch an already-imported copy). Idempotent on
//     UNIQUE(from_token, importer_id): a repeat returns { created:false, ... }.
import { randomUUID } from 'crypto';
import type { Pool } from 'pg';
import type { Taste } from '@yon/shared';
import { mintShareToken, importCodeFor } from './share-token';
import { copyPhoto, deletePhoto } from './storage';
import { variantKeys, isVariantKey, safeExt } from './image-variants';

// Reuse the shared pool singleton declared in db.ts.
declare global {
  // eslint-disable-next-line no-var
  var __pgPool: Pool | undefined;
}

function pool(): Pool {
  if (!globalThis.__pgPool) {
    throw new Error('pg pool not initialized');
  }
  return globalThis.__pgPool;
}

/** A share_tokens pointer row (snake → camel). */
export interface ShareTokenRow {
  token: string;
  tasteId: string;
  ownerId: string;
  revoked: boolean;
  expiresAt: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToShareToken(row: any): ShareTokenRow {
  return {
    token: row.token,
    tasteId: row.taste_id,
    ownerId: row.owner_id,
    revoked: Boolean(row.revoked),
    expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
  };
}

/**
 * Insert ONE thin pointer row. Ownership is enforced by the caller (the route
 * checks getTaste(user.id, id) first). No jsonb snapshot, no photo copy here.
 */
export async function createShareToken(input: {
  tasteId: string;
  ownerId: string;
  expiresAt?: Date | null;
}): Promise<ShareTokenRow> {
  const expiresAt = input.expiresAt ?? null;
  const MAX_ATTEMPTS = 5;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // Re-mint a fresh token on every attempt so a derived import_code collision
    // (unique partial index violation, pg code 23505) gets a genuinely new code.
    const token = mintShareToken();
    // Compute + STORE the import code at mint so resolve is an indexed O(1)
    // lookup instead of a full scan that re-derives the code per live token.
    const importCode = importCodeFor(token);
    try {
      const { rows } = await pool().query(
        `INSERT INTO share_tokens (token, taste_id, owner_id, import_code, expires_at)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [token, input.tasteId, input.ownerId, importCode, expiresAt]
      );
      return rowToShareToken(rows[0]);
    } catch (err: unknown) {
      // 23505 = unique_violation: the derived import_code collided with an
      // existing live token. Re-mint produces a fresh code; retry resolves it.
      if (attempt < MAX_ATTEMPTS && (err as { code?: string }).code === '23505') {
        continue;
      }
      throw err;
    }
  }
  // Unreachable — the loop always either returns or throws; TypeScript needs this.
  throw new Error('createShareToken: exceeded max retry attempts');
}

/** Fetch the raw pointer row for a token, or null. The route decides 410 from
 *  revoked / expired / source-deleted — this is a pure lookup. */
export async function getShareToken(token: string): Promise<ShareTokenRow | null> {
  const { rows } = await pool().query(
    'SELECT * FROM share_tokens WHERE token = $1',
    [token]
  );
  return rows.length ? rowToShareToken(rows[0]) : null;
}

/** Revoke a token, owner-scoped. Returns true when a row was revoked (so a
 *  non-owner — or an already-revoked token — yields false → route 404). */
export async function revokeShareToken(input: {
  ownerId: string;
  tasteId: string;
}): Promise<boolean> {
  const { rowCount } = await pool().query(
    `UPDATE share_tokens SET revoked = true
      WHERE taste_id = $1 AND owner_id = $2 AND revoked = false`,
    [input.tasteId, input.ownerId]
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Resolve a printed import code → a live (non-revoked, unexpired) token. The
 * code is STORED + indexed on share_tokens (computed at mint), so this is an
 * O(1) indexed lookup — NOT a full scan that re-derives the code for every live
 * token (that was O(N) in CPU/memory and a DoS amplifier as the table grew).
 * Rate-limited at the route (GET /api/share/resolve) so the ~30-bit code space
 * cannot be brute-forced.
 */
export async function resolveImportCode(code: string): Promise<string | null> {
  const { rows } = await pool().query(
    `SELECT token FROM share_tokens
      WHERE import_code = $1
        AND revoked = false
        AND (expires_at IS NULL OR expires_at > now())
      LIMIT 1`,
    [code]
  );
  return rows.length ? (rows[0].token as string) : null;
}

/** Result of importSharedTaste — `created:false` on an idempotent repeat. */
export interface ImportResult {
  created: boolean;
  taste: Taste;
}

/**
 * Copy a shared taste into the importer's library as a status='todo',
 * verdict=null row, copying the photo into the importer's namespace AT THIS
 * POINT (copy-on-import) so the copy is decoupled from the source. Writes
 * taste_imports for provenance. Idempotent on UNIQUE(from_token, importer_id):
 * a repeat returns { created:false } with the existing copy.
 *
 * Returns null only when the source taste no longer exists (route → 410). The
 * route is responsible for the revoked/expired gate (it has the pointer row).
 */
export async function importSharedTaste(input: {
  token: string;
  importerId: string;
}): Promise<ImportResult | null> {
  const { token, importerId } = input;
  const { getTaste, getRawImage } = await import('./db');

  const ptr = await getShareToken(token);
  if (!ptr) return null;

  // Live source + its raw key (for copy-on-import).
  const source = await getTaste(ptr.ownerId, ptr.tasteId);
  if (!source) return null;
  const rawImage = await getRawImage(ptr.ownerId, ptr.tasteId);

  // Idempotency (fast path): if this importer already imported this token,
  // return the copy without copying anything. The authoritative idempotency +
  // revocation re-check happen inside the transaction below (FOR UPDATE).
  const { rows: existing } = await pool().query(
    'SELECT taste_id FROM taste_imports WHERE from_token = $1 AND importer_id = $2',
    [token, importerId]
  );
  if (existing.length) {
    const copy = await getTaste(importerId, existing[0].taste_id);
    if (copy) return { created: false, taste: copy };
    // Recorded copy was deleted by the importer — fall through and re-import.
  }

  // Tracks any R2 object copied inside the transaction so a rollback (race or
  // error) can delete it instead of orphaning it (storage leak otherwise).
  let copiedImage = '';

  const client = await pool().connect();
  try {
    await client.query('BEGIN');

    // TOCTOU guard: lock the pointer row and re-validate revoked/expiry INSIDE
    // the transaction. The route's gate ran outside any transaction, so the
    // owner could have revoked between that check and here — without this lock
    // the import would commit against a revoked token.
    const { rows: lockRows } = await client.query(
      `SELECT revoked, expires_at FROM share_tokens WHERE token = $1 FOR UPDATE`,
      [token]
    );
    if (!lockRows.length) {
      await client.query('ROLLBACK');
      return null; // token vanished (source deleted → cascade) → route 410
    }
    const locked = lockRows[0];
    const expired =
      locked.expires_at != null && new Date(locked.expires_at).getTime() <= Date.now();
    if (locked.revoked || expired) {
      await client.query('ROLLBACK');
      return null; // revoked/expired at commit time → route 410
    }

    // Copy-on-import happens INSIDE the transaction so a rollback can clean up
    // the copied object. The DB insert below is what makes the copy "real".
    copiedImage = await copySourcePhoto(rawImage);

    // lat/lng are DELIBERATELY omitted from this INSERT (privacy): the importer
    // must not receive the owner's exact coordinates. Consistent with S3c geo
    // coarsening — do NOT start copying lat/lng here.
    const ins = await client.query(
      `INSERT INTO tastes (user_id, name, place, price, status, verdict, tags, notes, image)
       VALUES ($1, $2, $3, $4, 'todo', NULL, $5, $6, $7)
       RETURNING id`,
      [
        importerId,
        source.name,
        source.place ?? '',
        source.price ?? '',
        source.tags ?? [],
        source.notes ?? '',
        copiedImage,
      ]
    );
    const copyId = ins.rows[0].id as string;

    const prov = await client.query(
      `INSERT INTO taste_imports (taste_id, from_token, from_user_id, importer_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (from_token, importer_id) DO NOTHING
       RETURNING taste_id`,
      [copyId, token, ptr.ownerId, importerId]
    );

    if (!prov.rows.length) {
      // Lost a concurrent race — roll back our copy and return the winner's.
      await client.query('ROLLBACK');
      await cleanupOrphanedCopy(copiedImage);
      const { rows: winner } = await pool().query(
        'SELECT taste_id FROM taste_imports WHERE from_token = $1 AND importer_id = $2',
        [token, importerId]
      );
      if (winner.length) {
        const copy = await getTaste(importerId, winner[0].taste_id);
        if (copy) return { created: false, taste: copy };
      }
      return null;
    }

    await client.query('COMMIT');
    const copy = await getTaste(importerId, copyId);
    if (!copy) return null;
    return { created: true, taste: copy };
  } catch (err) {
    await client.query('ROLLBACK');
    // The transaction did not commit, so any photo we copied is now orphaned —
    // best-effort delete it so a failed import does not leak storage.
    await cleanupOrphanedCopy(copiedImage);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Best-effort delete of a copied (now-orphaned) photo + its variants after a
 * rolled-back import. Never throws: cleanup failure must not mask the import
 * outcome (the worst case is a single orphaned object, logged for ops).
 */
async function cleanupOrphanedCopy(copiedImage: string): Promise<void> {
  if (!copiedImage) return;
  try {
    if (isVariantKey(copiedImage)) {
      const v = variantKeys(copiedImage);
      await Promise.all([
        deletePhoto(v.orig),
        deletePhoto(v.thumb),
        deletePhoto(v.display),
      ]);
    } else {
      await deletePhoto(copiedImage);
    }
  } catch (err) {
    console.error('cleanupOrphanedCopy: failed to delete orphaned import copy:', err);
  }
}

/**
 * Copy the source photo (orig + thumb + display variants when present) into a
 * fresh canonical-layout key (t/{uuid}/orig.{ext}) and return the value to
 * persist in the copy's `image` column. The new uuid decouples the copy from the
 * owner's object; isolation is enforced at the row level by user_id scoping.
 * Empty / legacy-URL sources yield '' (the import still succeeds, photoless and
 * decoupled). Best-effort: a copy failure leaves the copy photoless rather than
 * failing the whole import.
 */
async function copySourcePhoto(rawImage: string | null): Promise<string> {
  if (!rawImage) return '';
  if (
    rawImage.startsWith('http://') ||
    rawImage.startsWith('https://') ||
    rawImage.startsWith('/uploads/')
  ) {
    return '';
  }

  // Use the CANONICAL variant layout (t/{uuid}/orig.{ext}) — NOT an importer-id
  // prefix. The fresh uuid already decouples the copy from the owner's key, and
  // row-level isolation is enforced by user_id scoping in getTaste/queries, so a
  // path prefix is not needed for isolation. An importer-prefixed key would fail
  // isVariantKey (anchored /^t\/…/), so resolvePhotoUrls would treat the copy as
  // a flat legacy key and serve the full-res ORIGINAL instead of the thumb/display
  // variants this function copies — the very regression this layout avoids.
  try {
    if (isVariantKey(rawImage)) {
      const ext = rawImage.slice(rawImage.lastIndexOf('.') + 1);
      const newOrig = `t/${randomUUID()}/orig.${safeExt(`x.${ext}`)}`;
      const srcV = variantKeys(rawImage);
      const dstV = variantKeys(newOrig);
      await Promise.all([
        copyPhoto(srcV.orig, dstV.orig),
        copyPhoto(srcV.thumb, dstV.thumb),
        copyPhoto(srcV.display, dstV.display),
      ]);
      return newOrig;
    }
    // Flat (pre-variant) source: no thumb/display siblings exist, so keep the
    // copy a FLAT key too (a t/{uuid}/orig.{ext} key would make the resolver
    // look for variants that were never written). Use a fresh-uuid flat key.
    const ext = rawImage.includes('.') ? rawImage.slice(rawImage.lastIndexOf('.') + 1) : 'bin';
    const newKey = `${randomUUID()}.${safeExt(`x.${ext}`)}`;
    return await copyPhoto(rawImage, newKey);
  } catch (err) {
    console.error('copySourcePhoto: copy failed, importing photoless:', err);
    return '';
  }
}
