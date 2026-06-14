// DB client singleton + typed query helpers for Yummy or Not.
// Uses a globalThis-cached Pool so Next.js hot reloads don't exhaust connections.
import { createHash } from 'crypto';
import { Pool } from 'pg';
import type { Taste, Stats, CreateTasteInput, UpdateTasteInput, User, Plan, UserTag, TastePurchase, UpdateUserInput, Taster, CreateTasterInput, UpdateTasterInput } from '@yon/shared';
import { FILTERS, geohashCellsInRadius, geohashCellsInBbox } from '@yon/shared';
import type { ProviderProfile } from './oauth';
import { getPhotoPublicBaseUrl, getPhotoStorage, getPhotoCdnBaseUrl } from './env';
import { getSignedPhotoUrl } from './storage';
import { variantKeys, isVariantKey } from './image-variants';
import { normalizePromoCode, isPromoExpired, promoHasUsesLeft, type PromoCodeRow } from './promo';

// ── Pool singleton ────────────────────────────────────────────────────────────

declare global {
  // eslint-disable-next-line no-var
  var __pgPool: Pool | undefined;
}

function getPool(): Pool {
  if (!globalThis.__pgPool) {
    globalThis.__pgPool = new Pool({
      connectionString: process.env.DATABASE_URL,
    });
  }
  return globalThis.__pgPool;
}

const pool = getPool();

function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Epoch millis of a taste's most recent activity: the later of its creation
 *  and its newest purchase. Repurchasing bumps both the displayed `date` and
 *  the list sort order. `purchases` is newest-first, so [0] is the latest. */
function lastActivityMs(taste: Taste): number {
  const createdMs = new Date(taste.createdAt).getTime();
  const newestPurchaseMs = taste.purchases.length
    ? new Date(taste.purchases[0].createdAt).getTime()
    : 0;
  return Math.max(createdMs, newestPurchaseMs);
}

/** Build a human-readable relative date string from a DB timestamptz. */
function relativeDate(createdAt: Date): string {
  const diffMs = Date.now() - createdAt.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} minute${diffMin === 1 ? '' : 's'} ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hour${diffHr === 1 ? '' : 's'} ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay === 1) return 'yesterday';
  if (diffDay < 7) return `${diffDay} days ago`;
  const diffWk = Math.floor(diffDay / 7);
  if (diffWk === 1) return '1 week ago';
  if (diffWk < 5) return `${diffWk} weeks ago`;
  const diffMo = Math.floor(diffDay / 30);
  if (diffMo === 1) return '1 month ago';
  return `${diffMo} months ago`;
}

/** Return true when the stored image value is a legacy absolute URL or local
 *  path that should be passed through unchanged (no variants, no presigning).
 *  Single source of truth shared by resolvePhotoUrls and imageKeyFromRow. */
function isLegacyPhotoValue(image: string): boolean {
  return (
    image.startsWith('http://') ||
    image.startsWith('https://') ||
    image.startsWith('/uploads/')
  );
}

/** Resolve a stored `image` key into the three client-facing URLs.
 *
 *  Cases:
 *  - falsy              → all three ''
 *  - legacy absolute    → http(s)://, /uploads/: pass through; same URL in all
 *                         three fields (no variants exist for these rows)
 *  - isVariantKey + CDN → derive thumb/display from CDN base; image = display;
 *                         NEVER emit the orig key as a public URL
 *  - isVariantKey + s3  → presign thumb and display keys; image = display
 *  - isVariantKey + local → join PHOTO_PUBLIC_BASE_URL; image = display
 */
export async function resolvePhotoUrls(image: string | null | undefined): Promise<{
  image: string;
  imageThumb: string;
  imageDisplay: string;
}> {
  if (!image) return { image: '', imageThumb: '', imageDisplay: '' };

  // Legacy absolute URLs — no variants, pass straight through.
  if (isLegacyPhotoValue(image)) {
    return { image, imageThumb: image, imageDisplay: image };
  }

  const key = image.replace(/^\//, '');

  if (isVariantKey(key)) {
    const { thumb, display } = variantKeys(key);
    const cdn = getPhotoCdnBaseUrl();

    if (cdn) {
      const thumbUrl   = `${cdn}/${thumb}`;
      const displayUrl = `${cdn}/${display}`;
      return { image: displayUrl, imageThumb: thumbUrl, imageDisplay: displayUrl };
    }

    if (getPhotoStorage() === 's3') {
      const [thumbUrl, displayUrl] = await Promise.all([
        getSignedPhotoUrl(thumb),
        getSignedPhotoUrl(display),
      ]);
      return { image: displayUrl, imageThumb: thumbUrl, imageDisplay: displayUrl };
    }

    // Local backend.
    const base = getPhotoPublicBaseUrl();
    const thumbUrl   = base ? `${base}/${thumb}`   : `/${thumb}`;
    const displayUrl = base ? `${base}/${display}` : `/${display}`;
    return { image: displayUrl, imageThumb: thumbUrl, imageDisplay: displayUrl };
  }

  // Old flat key (pre-variant, single upload) — resolve like before.
  let resolved: string;
  if (getPhotoStorage() === 's3') {
    resolved = await getSignedPhotoUrl(key);
  } else {
    const base = getPhotoPublicBaseUrl();
    resolved = base ? `${base}/${key}` : `/${key}`;
  }
  return { image: resolved, imageThumb: resolved, imageDisplay: resolved };
}

/** Return the stable bare storage key for a given DB image value.
 *  Uses isLegacyPhotoValue as the single source of truth for legacy detection,
 *  so this stays in sync with resolvePhotoUrls automatically. */
export function imageKeyFromRow(image: string | null | undefined): string {
  if (!image) return '';
  if (isLegacyPhotoValue(image)) return '';
  return image;
}

/** Map a taste_purchases row to the client-facing TastePurchase shape. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToPurchase(row: any): TastePurchase {
  let price: string | null = null;
  if (row.price != null) {
    const n = parseFloat(String(row.price));
    price = isNaN(n) ? String(row.price) : n.toFixed(2);
  }
  return {
    id:        row.id,
    tasteId:   row.taste_id,
    price,
    place:     row.place ?? null,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

/** Fetch the purchases ledger for a taste (newest first) and count. */
async function fetchPurchasesForTaste(
  tasteId: string
): Promise<{ purchases: TastePurchase[]; count: number }> {
  const { rows } = await pool.query(
    'SELECT * FROM taste_purchases WHERE taste_id = $1 ORDER BY created_at DESC',
    [tasteId]
  );
  return { purchases: rows.map(rowToPurchase), count: rows.length };
}

/** Parse a Postgres text-array value that may arrive as a JS array (real pg)
 *  or as a string like '{"Boba","Ramen"}' / '{}' (pg-mem). */
function parsePgArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== 'string') return [];
  const s = value.trim();
  if (s === '{}') return [];
  // Strip outer braces, split on commas, strip surrounding quotes
  const inner = s.replace(/^\{|\}$/g, '');
  return inner.split(',').map((el) => el.replace(/^"|"$/g, '').trim()).filter(Boolean);
}

/** Map a DB row (snake_case) to a Taste (camelCase).
 *  Fetches purchases from the ledger to compute the derived boughtCount. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function rowToTaste(row: any): Promise<Taste> {
  const urls = await resolvePhotoUrls(row.image);

  // If the caller pre-fetched purchases (purchase_count + purchases_json on row),
  // use them directly. Otherwise do a separate query. This keeps list queries
  // from issuing N+1 queries when the caller passes the aggregated data.
  let purchases: TastePurchase[];
  let purchaseCount: number;

  if (row.purchase_count != null) {
    purchaseCount = Number(row.purchase_count);
    purchases = Array.isArray(row.purchases_json) ? row.purchases_json.map(rowToPurchase) : [];
  } else {
    const fetched = await fetchPurchasesForTaste(row.id);
    purchases = fetched.purchases;
    purchaseCount = fetched.count;
  }

  // `date` tracks the most recent activity (creation or newest purchase) so a
  // repurchase refreshes the displayed "X days ago" → "just now". `purchases`
  // is newest-first, so [0] is the latest.
  const createdAt = new Date(row.created_at);
  const newestPurchaseAt = purchases.length ? new Date(purchases[0].createdAt) : null;
  const lastActivityAt =
    newestPurchaseAt && newestPurchaseAt.getTime() > createdAt.getTime()
      ? newestPurchaseAt
      : createdAt;

  return {
    id:            row.id,
    name:          row.name,
    place:         row.place ?? '',
    price:         row.price ?? '',
    status:        row.status ?? 'tasted',
    verdict:       row.verdict ?? null,
    tags:          parsePgArray(row.tags).flatMap((t: string) => normalizeTag(t)),
    boughtCount:   1 + purchaseCount,
    warnBeforeBuy: Boolean(row.warn_before_buy),
    purchases,
    date:          relativeDate(lastActivityAt),
    notes:         row.notes ?? '',
    lat:           row.lat ?? null,
    lng:           row.lng ?? null,
    tasterId:      row.taster_id ?? null,
    image:         urls.image,
    imageThumb:    urls.imageThumb,
    imageDisplay:  urls.imageDisplay,
    imageKey:      imageKeyFromRow(row.image),
    createdAt:     new Date(row.created_at).toISOString(),
  };
}

/** Parse a price string like "$5.80" → 5.80, returning 0 on failure. */
function parsePrice(price: string): number {
  const n = parseFloat(price.replace(/[^0-9.]/g, ''));
  return isNaN(n) ? 0 : n;
}

/** Normalize a price string to "x.yy" format on write.
 *  Strips non-numeric chars; if it parses as a number returns "n.toFixed(2)".
 *  Leaves non-numeric strings (e.g. "—") untouched. Empty → "". */
export function normalizePrice(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const digits = trimmed.replace(/[^0-9.]/g, '');
  const n = parseFloat(digits);
  if (!isNaN(n)) return n.toFixed(2);
  return trimmed;
}

/** Flatten a single tag value that may be a JSON-encoded array string (legacy data). */
function normalizeTag(tag: string): string[] {
  const t = tag.trim();
  if (t.startsWith('[')) {
    try {
      const parsed = JSON.parse(t);
      if (Array.isArray(parsed)) {
        return parsed.map(String).map((s) => s.trim()).filter(Boolean);
      }
    } catch {
      // fall through
    }
  }
  return t ? [t] : [];
}

// ── Query helpers ─────────────────────────────────────────────────────────────

/** List a user's tastes, optionally filtered by a search term and/or tag. Newest first.
 *  rowToTaste fetches purchases per row; acceptable for list sizes in practice. */
export async function listTastes(
  userId: string,
  {
    q,
    filter,
    status = 'tasted',
    taster,
  }: {
    q?: string;
    filter?: string;
    /** Lifecycle filter: 'tasted' (DEFAULT — old clients never see todos),
     *  'todo' (wishlist only), or 'all' (no status condition). */
    status?: 'tasted' | 'todo' | 'all';
    /** S3b: restrict to records attributed to this taster persona. Omitted →
     *  no taster condition (all of the owner's personas). */
    taster?: string;
  } = {}
): Promise<Taste[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const values: any[] = [userId];
  const conditions: string[] = [`user_id = $1`];

  if (q && q.trim()) {
    values.push(`%${q.trim().toLowerCase()}%`);
    conditions.push(
      `(lower(name) LIKE $${values.length} OR lower(place) LIKE $${values.length})`
    );
  }

  if (filter && filter !== 'All') {
    values.push(filter);
    conditions.push(`$${values.length} = ANY(tags)`);
  }

  if (status !== 'all') {
    values.push(status);
    conditions.push(`status = $${values.length}`);
  }

  if (taster) {
    // Scope the taster filter to a persona THIS account owns. The existing
    // `user_id = $1` conjunct already prevents a cross-user read, but don't
    // rely on it alone: bind the taster to its owner in the condition itself so
    // a foreign taster id can never match even if the query is later refactored.
    values.push(taster);
    const tasterParam = values.length;
    values.push(userId);
    const ownerParam = values.length;
    conditions.push(
      `taster_id = (SELECT id FROM tasters WHERE id = $${tasterParam} AND owner_account_id = $${ownerParam})`
    );
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const sql = `SELECT * FROM tastes ${where} ORDER BY created_at DESC`;

  const { rows } = await pool.query(sql, values);
  const tastes = await Promise.all(rows.map(rowToTaste));
  // Order by most recent activity so a repurchase bumps the item to the top.
  // SQL can't see the purchases ledger here without a correlated subquery, so
  // sort the materialized rows (list sizes are small in practice). The sort is
  // stable, so `created_at DESC` remains the tiebreak for equal activity.
  tastes.sort((a, b) => lastActivityMs(b) - lastActivityMs(a));
  return tastes;
}

/** Fetch a single taste owned by the user; returns null if not found. */
export async function getTaste(userId: string, id: string): Promise<Taste | null> {
  const { rows } = await pool.query(
    'SELECT * FROM tastes WHERE id = $1 AND user_id = $2',
    [id, userId]
  );
  return rows.length ? await rowToTaste(rows[0]) : null;
}

/** Thrown by createTaste when an explicit tasterId does not belong to the
 *  calling account (IDOR guard). The route maps `.code` to a 400 error body.
 *  A thrown error (rather than a union return) keeps the happy-path return type
 *  a plain Taste for the many existing callers, while still enforcing ownership
 *  at the DB-helper level — not only at the route. */
export class CreateTasteError extends Error {
  constructor(public readonly code: 'invalid_taster') {
    super(code);
    this.name = 'CreateTasteError';
  }
}

/** Insert a new taste owned by the user, optionally overriding the image URL.
 *  warn_before_buy defaults to true when verdict is 'nah', false otherwise.
 *  Throws CreateTasteError('invalid_taster') when an explicit tasterId is not
 *  owned by userId. */
export async function createTaste(
  userId: string,
  input: CreateTasteInput,
  imageUrl?: string
): Promise<Taste> {
  const {
    name,
    place = '',
    price = '',
    verdict,
    tags = [],
    notes = '',
    image = '',
    status = 'tasted',
  } = input;

  // A todo (wishlist) row is never scored: force verdict null and clear the
  // repurchase warning regardless of what the client sent.
  const isTodo = status === 'todo';
  const effectiveVerdict = isTodo ? null : verdict;

  const resolvedImage = imageUrl ?? image;
  const normalizedPrice = normalizePrice(price);
  const warnBeforeBuy = !isTodo && effectiveVerdict === 'nah';
  const normalizedLat =
    typeof input.lat === 'number' && Number.isFinite(input.lat) && input.lat >= -90 && input.lat <= 90
      ? input.lat
      : null;
  const normalizedLng =
    typeof input.lng === 'number' && Number.isFinite(input.lng) && input.lng >= -180 && input.lng <= 180
      ? input.lng
      : null;

  // S3b: attribute the record to the active taster. An explicit tasterId (the
  // client's active persona) must belong to THIS account — otherwise an
  // authenticated user could stamp a record onto a foreign persona (IDOR). The
  // DB FK only requires the taster to exist globally, so verify ownership here
  // before insert. No explicit tasterId → fall back to the owner's self-taster
  // so every row is attributed (never NULL on a fresh insert). The self-taster
  // is auto-created on registration but ensure it here too so a pre-S3b account
  // that hasn't been touched still resolves to a stable id.
  let tasterId: string;
  if (input.tasterId) {
    const owned = await getTaster(userId, input.tasterId);
    if (!owned) throw new CreateTasteError('invalid_taster');
    tasterId = owned.id;
  } else {
    tasterId = (await ensureSelfTaster(userId)).id;
  }

  const { rows } = await pool.query(
    `INSERT INTO tastes (user_id, name, place, price, status, verdict, tags, notes, image, warn_before_buy, lat, lng, taster_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING *`,
    [userId, name, place, normalizedPrice, status, effectiveVerdict, tags, notes, resolvedImage, warnBeforeBuy, normalizedLat, normalizedLng, tasterId]
  );
  // New taste has no purchases yet — pass empty aggregates directly.
  const row = { ...rows[0], purchase_count: 0, purchases_json: [] };
  return await rowToTaste(row);
}

/** Machine-readable reasons a PATCH was rejected by the status/verdict rules.
 *  The route maps these to a 400 with the matching `error` code. */
export type UpdateTasteError =
  | 'invalid_status_transition'
  | 'verdict_required';

/** Patch a taste owned by the user; returns the updated Taste, null if not
 *  found, or a machine-readable error when the promotion rules are violated. */
export async function updateTaste(
  userId: string,
  id: string,
  patch: UpdateTasteInput
): Promise<Taste | UpdateTasteError | null> {
  // ── Status / verdict invariant ─────────────────────────────────────────────
  // Status is promote-only: the sole accepted value is 'tasted'. The type already
  // narrows UpdateTasteInput.status to 'tasted', but the body is untrusted at
  // runtime, so re-check here.
  if (patch.status !== undefined && patch.status !== 'tasted') {
    return 'invalid_status_transition';
  }
  // Enforce the DB CHECK (status<>'tasted' OR verdict IS NOT NULL) in app code,
  // computed over the RESULTING row — not just promotion patches. This catches
  // the back door of PATCH {verdict:null} on an already-tasted row (no status
  // field) which would otherwise produce tasted + NULL verdict (a 500 / corrupt
  // row in prod, silently allowed where the CHECK isn't enforced, e.g. pg-mem).
  // Only fetch the existing row when the patch could violate the invariant.
  if (patch.status === 'tasted' || patch.verdict !== undefined) {
    const existing = await getTaste(userId, id);
    if (!existing) return null;
    const resultingStatus = patch.status ?? existing.status;
    const resultingVerdict =
      patch.verdict !== undefined ? patch.verdict : existing.verdict;
    if (resultingStatus === 'tasted' && !resultingVerdict) {
      return 'verdict_required';
    }
  }

  // Build SET clauses dynamically from provided fields.
  const setClauses: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const values: any[] = [];

  // NOTE: `image` is intentionally NOT updatable here. The image column is owned
  // by the upload pipeline (POST /api/tastes assigns server-generated keys). If a
  // client could PATCH `image` to an arbitrary bare key, it could point at another
  // user's object and mint a presigned original via /original (IDOR). Keep image
  // out of the patch surface entirely.
  // NOTE: `incrementBought` is intentionally ignored here. boughtCount is now
  // derived from taste_purchases; use POST /api/tastes/:id/purchases to record
  // a new purchase.
  const fieldMap: Record<string, string> = {
    name:          'name',
    place:         'place',
    price:         'price',
    status:        'status',
    verdict:       'verdict',
    tags:          'tags',
    notes:         'notes',
    warnBeforeBuy: 'warn_before_buy',
  };

  for (const [key, col] of Object.entries(fieldMap)) {
    if (key in patch && patch[key as keyof UpdateTasteInput] !== undefined) {
      let val = patch[key as keyof UpdateTasteInput];
      if (key === 'price' && typeof val === 'string') {
        val = normalizePrice(val);
      }
      values.push(val);
      setClauses.push(`${col} = $${values.length}`);
    }
  }

  if (setClauses.length === 0) {
    // Nothing to change — just return existing row.
    return getTaste(userId, id);
  }

  values.push(id);
  const idParam = values.length;
  values.push(userId);
  const userParam = values.length;
  const sql = `UPDATE tastes SET ${setClauses.join(', ')} WHERE id = $${idParam} AND user_id = $${userParam} RETURNING *`;

  const { rows } = await pool.query(sql, values);
  if (!rows.length) return null;
  // Re-fetch with purchases join so the returned Taste has correct derived fields.
  return getTaste(userId, id);
}

/** Fetch the RAW stored `image` value (key or legacy URL) for a taste.
 *  Unlike getTaste, this does NOT run resolvePhotoUrl, so callers that need
 *  the original storage key (e.g. to delete the object) get it verbatim.
 *  Returns null if the row does not exist or is not owned by the user. */
export async function getRawImage(userId: string, id: string): Promise<string | null> {
  const { rows } = await pool.query(
    'SELECT image FROM tastes WHERE id = $1 AND user_id = $2',
    [id, userId]
  );
  return rows.length ? (rows[0].image ?? null) : null;
}

/** Delete a taste owned by the user; returns true if a row was deleted. */
export async function deleteTaste(userId: string, id: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    'DELETE FROM tastes WHERE id = $1 AND user_id = $2',
    [id, userId]
  );
  return (rowCount ?? 0) > 0;
}

/** Compute aggregate stats across the user's tastes. */
export async function getStats(userId: string): Promise<Stats> {
  const { rows } = await pool.query(`
    SELECT
      COUNT(*)                            AS total,
      COUNT(*) FILTER (WHERE verdict='yum') AS yum,
      COUNT(*) FILTER (WHERE verdict='meh') AS meh,
      COUNT(*) FILTER (WHERE verdict='nah') AS nah,
      COALESCE(
        json_agg(price) FILTER (WHERE verdict='nah'),
        '[]'
      )                                   AS nah_prices
    FROM tastes
    WHERE user_id = $1 AND status = 'tasted'
  `, [userId]);

  const row = rows[0];
  const nahPrices: string[] = Array.isArray(row.nah_prices) ? row.nah_prices : [];
  const saved = nahPrices.reduce((sum, p) => sum + parsePrice(p), 0);

  return {
    total: Number(row.total),
    yum:   Number(row.yum),
    meh:   Number(row.meh),
    nah:   Number(row.nah),
    savedAmount: `$${saved.toFixed(2)}`,
  };
}

// ── Tasters & families (S3b) ──────────────────────────────────────────────────

/** Map a tasters row (snake_case) → the client-facing Taster (camelCase). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToTaster(row: any): Taster {
  return {
    id:             row.id,
    ownerAccountId: row.owner_account_id,
    familyId:       row.family_id ?? null,
    displayName:    row.display_name ?? '',
    avatar:         row.avatar ?? '',
    isSelf:         Boolean(row.is_self),
    createdAt:      new Date(row.created_at).toISOString(),
  };
}

/** Return the owner's is_self taster, creating it on first call. Idempotent:
 *  a repeat call returns the SAME row (never mints a second self-taster). Called
 *  on registration (auto-create) and as the createTaste self-default fallback. */
export async function ensureSelfTaster(userId: string): Promise<Taster> {
  const existing = await pool.query(
    'SELECT * FROM tasters WHERE owner_account_id = $1 AND is_self = true LIMIT 1',
    [userId]
  );
  if (existing.rows.length) return rowToTaster(existing.rows[0]);

  // Name the self-taster after the account's display_name when present.
  const u = await pool.query('SELECT display_name FROM users WHERE id = $1', [userId]);
  const name = (u.rows[0]?.display_name as string | undefined)?.trim() || 'Me';
  // Race-safe insert. The SELECT above usually decides, but two concurrent
  // first-saves (or registration racing the first POST) can both miss it and
  // try to insert. The tasters_one_self_per_owner partial unique index makes the
  // loser's INSERT raise a unique violation; catch it and re-SELECT the winner's
  // row so both callers get the SAME id (no duplicate self-tasters → no split
  // attribution downstream). Catching the violation rather than using ON CONFLICT
  // (owner_account_id) WHERE is_self avoids the partial-index arbiter clause,
  // which behaves identically on real Postgres and the pg-mem test adapter.
  try {
    const { rows } = await pool.query(
      `INSERT INTO tasters (owner_account_id, display_name, is_self) VALUES ($1, $2, true) RETURNING *`,
      [userId, name]
    );
    return rowToTaster(rows[0]);
  } catch (err) {
    // Postgres unique_violation = 23505. The concurrent caller won; re-read it.
    if ((err as { code?: string })?.code !== '23505') throw err;
    const winner = await pool.query(
      'SELECT * FROM tasters WHERE owner_account_id = $1 AND is_self = true LIMIT 1',
      [userId]
    );
    if (!winner.rows.length) throw err;
    return rowToTaster(winner.rows[0]);
  }
}

/** Migration 0008 backfill (also runnable from app code / a one-off script):
 *  give every user exactly one is_self taster and point each of their
 *  still-unattributed tastes at it. Idempotent — re-running creates no
 *  duplicate self-tasters and never re-points an already-attributed row. */
export async function backfillSelfTasters(): Promise<void> {
  const { rows: users } = await pool.query('SELECT id FROM users');
  for (const u of users as Array<{ id: string }>) {
    const self = await ensureSelfTaster(u.id);
    await pool.query(
      'UPDATE tastes SET taster_id = $1 WHERE user_id = $2 AND taster_id IS NULL',
      [self.id, u.id]
    );
  }
}

/** List all personas owned by the account (self first, then newest). */
export async function listTasters(userId: string): Promise<Taster[]> {
  const { rows } = await pool.query(
    'SELECT * FROM tasters WHERE owner_account_id = $1 ORDER BY is_self DESC, created_at ASC',
    [userId]
  );
  return rows.map(rowToTaster);
}

/** Fetch a single taster owned by the account, or null. */
export async function getTaster(userId: string, id: string): Promise<Taster | null> {
  const { rows } = await pool.query(
    'SELECT * FROM tasters WHERE id = $1 AND owner_account_id = $2',
    [id, userId]
  );
  return rows.length ? rowToTaster(rows[0]) : null;
}

/** Create a non-self persona under the account. (Pro gating is enforced at the
 *  route layer — this helper is unconditional so the self-taster auto-create
 *  path stays usable.) */
export async function createTaster(
  userId: string,
  input: CreateTasterInput
): Promise<Taster> {
  const { rows } = await pool.query(
    `INSERT INTO tasters (owner_account_id, display_name, avatar, is_self)
     VALUES ($1, $2, $3, false) RETURNING *`,
    [userId, input.displayName.trim(), input.avatar ?? '']
  );
  return rowToTaster(rows[0]);
}

/** Patch a persona owned by the account; returns the updated row or null. */
export async function updateTaster(
  userId: string,
  id: string,
  patch: UpdateTasterInput
): Promise<Taster | null> {
  const setClauses: string[] = [];
  const values: unknown[] = [];

  if (patch.displayName !== undefined) {
    values.push(patch.displayName.trim());
    setClauses.push(`display_name = $${values.length}`);
  }
  if (patch.avatar !== undefined) {
    values.push(patch.avatar);
    setClauses.push(`avatar = $${values.length}`);
  }
  if (setClauses.length === 0) return getTaster(userId, id);

  values.push(id);
  const idParam = values.length;
  values.push(userId);
  const ownerParam = values.length;
  const { rows } = await pool.query(
    `UPDATE tasters SET ${setClauses.join(', ')} WHERE id = $${idParam} AND owner_account_id = $${ownerParam} RETURNING *`,
    values
  );
  return rows.length ? rowToTaster(rows[0]) : null;
}

/** Delete a persona owned by the account. Returns true if a row was deleted.
 *  Refuses to drop a self-taster (the route also guards this, defence in depth).
 *  Tastes attributed to it keep their data (FK is ON DELETE SET NULL). */
export async function deleteTaster(userId: string, id: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    'DELETE FROM tasters WHERE id = $1 AND owner_account_id = $2 AND is_self = false',
    [id, userId]
  );
  return (rowCount ?? 0) > 0;
}

// ── S3c: geo visibility + targeted publish + heat ─────────────────────────────

/** A targeted-publish instruction handed to setTasteVisibility. For 'geo' the
 *  route precomputes the coarsened gridCell + supplies the precise lat/lng for the
 *  geography point (the DOUBLE-WRITE). For 'family'/'member' only targetId is set. */
export interface VisibilityTarget {
  type: 'geo' | 'family' | 'member';
  /** geo only: precise coordinate to materialize as geog. */
  lat?: number;
  lng?: number;
  /** geo only: precomputed precision-5 geohash (the coarsened cell). */
  gridCell?: string;
  /** family/member only: family_id or member (taster_id). */
  targetId?: string | null;
}

/** A coarsened, anonymous geo-feed card. NEVER carries precise coords, owner
 *  identity, or precise address — only the privacy-safe grid_cell + display
 *  fields. This is the ONLY shape the cross-user geo feeds may return. */
export interface GeoFeedCard {
  id: string;
  name: string;
  verdict: string | null;
  image: string;
  imageThumb: string;
  imageDisplay: string;
  gridCell: string;
}

/** SELECT list shared by the coarsened geo feeds: the taste's display fields +
 *  the share's grid_cell. Deliberately omits ts.geog, t.lat, t.lng, t.user_id,
 *  t.place — anything that would deanonymize the card. */
const GEO_FEED_COLUMNS = `t.id, t.name, t.verdict, t.image, ts.grid_cell`;

async function rowToGeoFeedCard(row: {
  id: string;
  name: string;
  verdict: string | null;
  image: string | null;
  grid_cell: string | null;
}): Promise<GeoFeedCard> {
  const urls = await resolvePhotoUrls(row.image);
  return {
    id: row.id,
    name: row.name,
    verdict: row.verdict ?? null,
    image: urls.image,
    imageThumb: urls.imageThumb,
    imageDisplay: urls.imageDisplay,
    gridCell: row.grid_cell ?? '',
  };
}

/** Return the subset of `targetIds` that the caller does NOT own as either a
 *  taster (member target) or a family (family target). Used by the visibility
 *  route to reject publishing to an arbitrary/foreign target_id (record
 *  poisoning): a pro user could otherwise write a taste_shares row targeted at
 *  `some_other_user_id` and have it surface in that account's family feed.
 *
 *  S3c scope (no real cross-account membership): a valid family/member target is
 *  one of the caller's OWN personas (tasters.owner_account_id = caller) or OWN
 *  family containers (families.owner_id = caller). Anything else is unowned →
 *  the route 422s it. An empty input returns []. */
export async function findUnownedShareTargets(
  userId: string,
  targetIds: string[],
): Promise<string[]> {
  const unique = Array.from(new Set(targetIds.filter((t) => typeof t === 'string' && t.length > 0)));
  if (unique.length === 0) return [];
  const { rows } = await pool.query(
    `SELECT id FROM tasters  WHERE owner_account_id = $1 AND id = ANY($2::text[])
     UNION
     SELECT id FROM families WHERE owner_id         = $1 AND id = ANY($2::text[])`,
    [userId, unique],
  );
  const owned = new Set(rows.map((r) => String(r.id)));
  return unique.filter((t) => !owned.has(t));
}

/** Targeted publish: write taste_shares rows for the given targets and flip the
 *  taste to visibility='shared'. Ownership-checked (the taste must belong to
 *  userId). Returns the updated Taste, or null if the taste is not owned by the
 *  caller. geo targets DOUBLE-WRITE geog (from lat/lng) + grid_cell.
 *
 *  Idempotent at the taste level: re-publishing replaces this owner's existing
 *  shares for the taste so a second PATCH doesn't pile up duplicate rows. */
export async function setTasteVisibility(
  userId: string,
  id: string,
  targets: VisibilityTarget[],
): Promise<Taste | null> {
  // Ownership gate — the route already checks, but enforce at the helper too so a
  // foreign taste can never be published even if a future caller skips the route.
  const { rows: owned } = await pool.query(
    'SELECT id FROM tastes WHERE id = $1 AND user_id = $2',
    [id, userId],
  );
  if (!owned.length) return null;

  // Geo consistency guard (defence in depth — the route also 422s a coord-less
  // geo publish): a geo target MUST carry both a precise point and a coarsened
  // grid_cell. The migration's CHECK forbids a geo row with null geog/grid_cell,
  // so writing one would throw mid-loop; reject up front instead of leaving a
  // half-written publish. This protects future callers that skip the route guard.
  for (const target of targets) {
    if (target.type === 'geo') {
      const hasPoint = typeof target.lat === 'number' && typeof target.lng === 'number';
      if (!hasPoint || !target.gridCell) {
        throw new Error('setTasteVisibility: geo target requires lat, lng, and gridCell');
      }
    }
  }

  // Atomic publish: DELETE old shares + INSERT new + flip visibility must all
  // commit together. Without the transaction a crash between steps leaves the
  // taste marked 'shared' with no share rows (or stale shares with the flag),
  // i.e. an inconsistent visibility state that leaks or hides the wrong rows.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Replace this taste's existing shares so re-publishing is idempotent.
    await client.query('DELETE FROM taste_shares WHERE taste_id = $1 AND owner_id = $2', [id, userId]);

    for (const target of targets) {
      if (target.type === 'geo') {
        // DOUBLE-WRITE: geog from the precise point, grid_cell coarsened. ST_MakePoint
        // takes (lng, lat). The cast to geography sets SRID 4326.
        // eslint-disable-next-line no-await-in-loop
        await client.query(
          `INSERT INTO taste_shares (taste_id, owner_id, target_type, geog, grid_cell)
           VALUES ($1, $2, 'geo', ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography, $5)`,
          [id, userId, target.lng, target.lat, target.gridCell],
        );
      } else {
        // eslint-disable-next-line no-await-in-loop
        await client.query(
          `INSERT INTO taste_shares (taste_id, owner_id, target_type, target_id)
           VALUES ($1, $2, $3, $4)`,
          [id, userId, target.type, target.targetId ?? null],
        );
      }
    }

    await client.query(`UPDATE tastes SET visibility = 'shared' WHERE id = $1 AND user_id = $2`, [id, userId]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return getTaste(userId, id);
}

/** Cross-user GEO radius feed. Returns COARSENED cards for every PUBLISHED
 *  ('shared') geo taste whose grid_cell falls within the cells covering the
 *  query circle. visibility='shared' is the bypass-proof filter: a private /
 *  unpublished taste is never returned regardless of distance.
 *
 *  PRIVACY INVARIANT (S3c): this feed must NOT filter on the precise `ts.geog`.
 *  A precise ST_DWithin against an attacker-chosen tiny radius is a binary-search
 *  oracle that recovers exact coordinates even when the RESPONSE is coarsened.
 *  Instead we quantize the query to the SET of geohash-5 cells it covers and
 *  filter `grid_cell = ANY(cells)`. The finest resolution any radius can yield
 *  is then one ~5 km cell — two shares in the same cell are indistinguishable.
 *  The response still carries grid_cell only, never precise coords or identity. */
export async function listGeoFeedNear(q: {
  lat: number;
  lng: number;
  radiusM: number;
}): Promise<GeoFeedCard[]> {
  const cells = geohashCellsInRadius(q.lat, q.lng, q.radiusM, 5);
  if (cells.length === 0) return [];
  const { rows } = await pool.query(
    `SELECT ${GEO_FEED_COLUMNS}
       FROM taste_shares ts
       JOIN tastes t ON t.id = ts.taste_id
      WHERE ts.target_type = 'geo'
        AND t.visibility = 'shared'
        AND ts.grid_cell = ANY($1::text[])
      ORDER BY t.created_at DESC`,
    [cells],
  );
  return Promise.all(rows.map(rowToGeoFeedCard));
}

/** Cross-user GEO feed for one grid cell. Returns COARSENED cards for every
 *  PUBLISHED geo taste whose share landed in `cell`. Same visibility filter +
 *  same anonymous shape as the radius feed. */
export async function listGeoFeedByCell(cell: string): Promise<GeoFeedCard[]> {
  const { rows } = await pool.query(
    `SELECT ${GEO_FEED_COLUMNS}
       FROM taste_shares ts
       JOIN tastes t ON t.id = ts.taste_id
      WHERE ts.target_type = 'geo'
        AND t.visibility = 'shared'
        AND ts.grid_cell = $1
      ORDER BY t.created_at DESC`,
    [cell],
  );
  return Promise.all(rows.map(rowToGeoFeedCard));
}

/** Minimum shares in a grid cell before its heat bucket is published. Buckets
 *  below this are SUPPRESSED (k-anonymity): a count of 1 in a ~5 km cell is close
 *  to pinpointing a single person; only aggregates of ≥3 surface. */
export const HEAT_MIN_COUNT = 3;

/** Grid heat aggregation: count of PUBLISHED geo shares per grid_cell within a
 *  bounding box. Drives the heat map. Returns ONLY { cell, count } — no records,
 *  no coords, no identity.
 *
 *  PRIVACY INVARIANT (S3c): like the radius feed, this must NOT filter on the
 *  precise `ts.geog`. ST_Intersects against an attacker-shrunk envelope is a
 *  binary-search oracle that recovers exact coordinates. Instead we quantize the
 *  bbox to the SET of geohash-5 cells it covers and filter `grid_cell = ANY(...)`
 *  — the finest spatial resolution is one cell. A k-anonymity floor
 *  (HAVING COUNT(*) >= HEAT_MIN_COUNT) suppresses cells with too few shares so a
 *  surviving bucket never points at a single person. */
export async function geoHeat(bbox: {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}): Promise<Array<{ cell: string; count: number }>> {
  const cells = geohashCellsInBbox(
    { minLat: bbox.minLat, maxLat: bbox.maxLat, minLng: bbox.minLng, maxLng: bbox.maxLng },
    5,
  );
  if (cells.length === 0) return [];
  const { rows } = await pool.query(
    `SELECT ts.grid_cell AS cell, COUNT(*)::int AS count
       FROM taste_shares ts
       JOIN tastes t ON t.id = ts.taste_id
      WHERE ts.target_type = 'geo'
        AND t.visibility = 'shared'
        AND ts.grid_cell = ANY($1::text[])
      GROUP BY ts.grid_cell
     HAVING COUNT(*) >= $2
      ORDER BY ts.grid_cell ASC`,
    [cells, HEAT_MIN_COUNT],
  );
  return rows.map((r) => ({ cell: String(r.cell), count: Number(r.count) }));
}

/** Family / member feed: tastes the viewer is allowed to see via a family/member
 *  targeted publish. `member` (a taster/member id) narrows to one target. Only
 *  PUBLISHED ('shared') rows are ever returned.
 *
 *  VIEWER SCOPING (IDOR boundary — plan §S3c "family/member feed 均不得泄漏"):
 *  in S3c tasters are personas under the OWNER's account with NO real
 *  cross-account membership (plan: 真实账号互联…不在本期). The only legitimate
 *  reader of a family/member share is therefore the OWNER who published it,
 *  viewing their own personas' shares. We bind `ts.owner_id = $viewerId` so a
 *  caller can ONLY ever see their own rows — without this predicate every
 *  authenticated user would read every owner's family/member-targeted tastes
 *  across the whole platform. When a real cross-account membership model lands,
 *  this is where an explicit membership lookup would replace the owner check;
 *  never return family/member rows with no owner/viewer predicate. */
export async function listFamilyFeed(q: {
  viewerId: string;
  member?: string;
}): Promise<GeoFeedCard[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const values: any[] = [q.viewerId];
  const conditions: string[] = [
    `ts.owner_id = $1`,
    `ts.target_type IN ('family','member')`,
    `t.visibility = 'shared'`,
  ];
  if (q.member) {
    values.push(q.member);
    conditions.push(`ts.target_id = $${values.length}`);
  }
  const { rows } = await pool.query(
    `SELECT t.id, t.name, t.verdict, t.image, NULL AS grid_cell
       FROM taste_shares ts
       JOIN tastes t ON t.id = ts.taste_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY t.created_at DESC`,
    values,
  );
  return Promise.all(rows.map(rowToGeoFeedCard));
}

// ── Users & auth ────────────────────────────────────────────────────────────

/** Map a users row → the client-safe User (never includes password_hash). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToUser(row: any): User {
  return {
    id:              row.id,
    displayName:     row.display_name ?? '',
    phone:           row.phone ?? '',
    email:           row.email ?? '',
    avatar:          row.avatar ?? '',
    locale:          row.locale ?? 'zh',
    plan:            row.plan ?? 'free',
    warningsEnabled: row.warnings_enabled != null ? Boolean(row.warnings_enabled) : true,
    locationEnabled: row.location_enabled != null ? Boolean(row.location_enabled) : false,
    mediaEnabled:    row.media_enabled != null ? Boolean(row.media_enabled) : false,
    defaultVisibility: row.default_visibility === 'shared' ? 'shared' : 'private',
    createdAt:       new Date(row.created_at).toISOString(),
  };
}

export async function findUserById(id: string): Promise<User | null> {
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
  return rows.length ? rowToUser(rows[0]) : null;
}

export async function findUserByPhone(phone: string): Promise<User | null> {
  const { rows } = await pool.query('SELECT * FROM users WHERE phone = $1', [phone]);
  return rows.length ? rowToUser(rows[0]) : null;
}

/** Fetch by email INCLUDING the password hash — for login verification only. */
export async function findUserByEmailWithHash(
  email: string
): Promise<{ user: User; passwordHash: string | null } | null> {
  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
  if (!rows.length) return null;
  return { user: rowToUser(rows[0]), passwordHash: rows[0].password_hash ?? null };
}

export async function createUser(input: {
  displayName?: string;
  phone?: string;
  email?: string;
  passwordHash?: string;
  avatar?: string;
  locale?: string;
  plan?: Plan;
}): Promise<User> {
  const { rows } = await pool.query(
    `INSERT INTO users (display_name, phone, email, password_hash, avatar, locale, plan)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      input.displayName ?? '',
      input.phone ?? null,
      input.email ?? null,
      input.passwordHash ?? null,
      input.avatar ?? '',
      input.locale ?? 'zh',
      input.plan ?? 'free',
    ]
  );
  const user = rowToUser(rows[0]);
  // S3b: every new account gets its self-taster up front, so its records are
  // attributed from the very first save (idempotent — the createTaste fallback
  // also ensures one for pre-S3b accounts).
  await ensureSelfTaster(user.id);
  return user;
}

/** Phone-OTP login: return the existing user for this phone, or create one. */
export async function findOrCreateUserByPhone(phone: string): Promise<User> {
  const existing = await findUserByPhone(phone);
  if (existing) return existing;
  // Friendly default name from the last 4 digits.
  const tail = phone.replace(/[^0-9]/g, '').slice(-4);
  return createUser({ phone, displayName: `Foodie ${tail}` });
}

/**
 * Resolve a social login to a user: find the linked identity, else create a
 * fresh user and link it. Links to an existing email account when possible.
 */
export async function findOrCreateUserByOAuth(
  provider: string,
  profile: ProviderProfile
): Promise<User> {
  const linked = await pool.query(
    'SELECT user_id FROM auth_identities WHERE provider = $1 AND provider_uid = $2',
    [provider, profile.uid]
  );
  if (linked.rows.length) {
    const user = await findUserById(linked.rows[0].user_id);
    if (user) return user;
  }

  // No identity yet — reuse an account with the same email if present, else new.
  let user: User | null = null;
  if (profile.email) {
    const byEmail = await findUserByEmailWithHash(profile.email.toLowerCase());
    user = byEmail?.user ?? null;
  }
  if (!user) {
    user = await createUser({
      displayName: profile.displayName,
      email: profile.email?.toLowerCase(),
      avatar: profile.avatar ?? '',
    });
  }

  await pool.query(
    'INSERT INTO auth_identities (user_id, provider, provider_uid) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
    [user.id, provider, profile.uid]
  );
  return user;
}

// ── Sessions ─────────────────────────────────────────────────────────────────

export async function createSession(
  token: string,
  userId: string,
  expiresAt: Date,
  userAgent = ''
): Promise<void> {
  await pool.query(
    `INSERT INTO sessions (token_hash, user_id, expires_at, user_agent)
     VALUES ($1, $2, $3, $4)`,
    [hashSessionToken(token), userId, expiresAt, userAgent]
  );
}

/** Resolve a session token → its (unexpired) user, or null. */
export async function getSessionUser(token: string): Promise<User | null> {
  const { rows } = await pool.query(
    `SELECT u.* FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE (s.token_hash = $1 OR s.token = $2) AND s.expires_at > now()
      ORDER BY s.created_at DESC
      LIMIT 1`,
    [hashSessionToken(token), token]
  );
  return rows.length ? rowToUser(rows[0]) : null;
}

export async function deleteSession(token: string): Promise<void> {
  await pool.query('DELETE FROM sessions WHERE token_hash = $1 OR token = $2', [
    hashSessionToken(token),
    token,
  ]);
}

// ── Rate limiting ────────────────────────────────────────────────────────────

export async function hitRateLimit(
  key: string,
  limit: number,
  windowMs: number
): Promise<{ limited: boolean; retryAfterSeconds: number }> {
  const resetAt = new Date(Date.now() + windowMs);
  const { rows } = await pool.query(
    `INSERT INTO rate_limits (key, count, reset_at)
     VALUES ($1, 1, $2)
     ON CONFLICT (key) DO UPDATE SET
       count = CASE
         WHEN rate_limits.reset_at <= now() THEN 1
         ELSE rate_limits.count + 1
       END,
       reset_at = CASE
         WHEN rate_limits.reset_at <= now() THEN EXCLUDED.reset_at
         ELSE rate_limits.reset_at
       END,
       updated_at = now()
     RETURNING count, reset_at`,
    [key, resetAt]
  );
  const row = rows[0];
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((new Date(row.reset_at).getTime() - Date.now()) / 1000)
  );
  return { limited: Number(row.count) > limit, retryAfterSeconds };
}

// ── One-time codes (phone OTP) ───────────────────────────────────────────────

export async function saveOtp(
  phone: string,
  codeHash: string,
  expiresAt: Date
): Promise<void> {
  await pool.query(
    'INSERT INTO otp_codes (phone, code_hash, expires_at) VALUES ($1, $2, $3)',
    [phone, codeHash, expiresAt]
  );
}

/**
 * Verify and consume the most recent unexpired code for a phone.
 * Returns true on success (and marks every outstanding code for the phone used).
 */
export async function consumeOtp(phone: string, codeHash: string): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT id FROM otp_codes
      WHERE phone = $1 AND code_hash = $2 AND consumed = false AND expires_at > now()
      ORDER BY created_at DESC LIMIT 1`,
    [phone, codeHash]
  );
  if (!rows.length) return false;
  await pool.query('UPDATE otp_codes SET consumed = true WHERE phone = $1', [phone]);
  return true;
}

// ── Password reset tokens (email) ────────────────────────────────────────────

/** Persist a single-use password-reset token. We store only its sha256 hash —
 *  the raw token is mailed to the user and never written to the database. */
export async function savePasswordResetToken(
  userId: string,
  email: string,
  tokenHash: string,
  expiresAt: Date
): Promise<void> {
  await pool.query(
    `INSERT INTO password_reset_tokens (token_hash, user_id, email, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [tokenHash, userId, email, expiresAt]
  );
}

/**
 * Atomically consume a password-reset token: succeeds only when the token
 * exists, is unexpired, and has NOT been used. On success it stamps used_at in
 * the same statement (single-use, race-safe) and returns the owning user id;
 * returns null for any expired / already-used / unknown token.
 */
export async function consumePasswordResetToken(
  tokenHash: string
): Promise<{ userId: string } | null> {
  const { rows } = await pool.query(
    `UPDATE password_reset_tokens
        SET used_at = now()
      WHERE token_hash = $1
        AND used_at IS NULL
        AND expires_at > now()
      RETURNING user_id`,
    [tokenHash]
  );
  return rows.length ? { userId: rows[0].user_id } : null;
}

/** Set a user's password hash (used by the password-reset flow). */
export async function setUserPasswordHash(
  userId: string,
  passwordHash: string
): Promise<void> {
  await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [
    passwordHash,
    userId,
  ]);
}

/** Revoke every session for a user — called after a password reset so a stolen
 *  old session can't persist past the reset. */
export async function deleteUserSessions(userId: string): Promise<void> {
  await pool.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
}

// ── User tag candidate set ────────────────────────────────────────────────────

/** Map a user_tags row to the client-facing UserTag shape. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToUserTag(row: any): UserTag {
  return {
    id:        row.id,
    name:      row.name,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

/**
 * List all tags in the user's candidate set, sorted by name ascending.
 * On first call (zero rows) seeds the set from FILTERS defaults (minus "All")
 * plus any distinct tag values already present in the user's tastes.tags arrays.
 * The seed is idempotent: INSERT … ON CONFLICT DO NOTHING on the unique key.
 */
export async function listUserTags(userId: string): Promise<UserTag[]> {
  const { rows } = await pool.query(
    'SELECT * FROM user_tags WHERE user_id = $1 ORDER BY name ASC',
    [userId]
  );

  if (rows.length > 0) return rows.map(rowToUserTag);

  // Lazy seed: defaults (FILTERS without "All") + historical taste tags, deduped case-insensitively.
  const defaults = (FILTERS as readonly string[]).filter((f) => f !== 'All');

  // Fetch all tags arrays for this user's tastes and flatten in JS.
  // Avoids unnest()/array_length() which are not available in the pg-mem test adapter.
  const { rows: tasteTagRows } = await pool.query(
    `SELECT tags FROM tastes WHERE user_id = $1`,
    [userId]
  );
  const historicalTags: string[] = tasteTagRows
    .flatMap((r: { tags: string[] }) => (Array.isArray(r.tags) ? r.tags : []))
    .filter(Boolean);

  // Merge defaults + historical, dedup case-insensitively, preserve first occurrence casing.
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const t of [...defaults, ...historicalTags]) {
    const lower = t.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      merged.push(t);
    }
  }

  if (merged.length === 0) return [];

  // Bulk upsert — idempotent on the case-insensitive unique index (user_id, lower(name)).
  const placeholders = merged.map((_, i) => `($1, $${i + 2})`).join(', ');
  await pool.query(
    `INSERT INTO user_tags (user_id, name) VALUES ${placeholders} ON CONFLICT (user_id, lower(name)) DO NOTHING`,
    [userId, ...merged]
  );

  const { rows: seeded } = await pool.query(
    'SELECT * FROM user_tags WHERE user_id = $1 ORDER BY name ASC',
    [userId]
  );
  return seeded.map(rowToUserTag);
}

/**
 * Create (or upsert) a tag in the user's candidate set.
 * Returns the existing row on conflict so callers always get back a UserTag.
 */
export async function createUserTag(userId: string, name: string): Promise<UserTag> {
  const { rows } = await pool.query(
    `INSERT INTO user_tags (user_id, name) VALUES ($1, $2)
     ON CONFLICT (user_id, lower(name)) DO UPDATE SET name = EXCLUDED.name
     RETURNING *`,
    [userId, name]
  );
  return rowToUserTag(rows[0]);
}

/**
 * Rename a tag in the user's candidate set.
 * Returns the updated UserTag, or null if not found / not owned by the user.
 * Never touches tastes.tags.
 */
export async function renameUserTag(
  userId: string,
  id: string,
  name: string
): Promise<UserTag | 'not_found' | 'name_conflict'> {
  // Reject if another tag (different id) already occupies the same case-insensitive name.
  const { rows: conflict } = await pool.query(
    `SELECT 1 FROM user_tags WHERE user_id = $1 AND lower(name) = lower($2) AND id <> $3`,
    [userId, name, id]
  );
  if (conflict.length) return 'name_conflict';

  const { rows } = await pool.query(
    `UPDATE user_tags SET name = $3 WHERE id = $1 AND user_id = $2 RETURNING *`,
    [id, userId, name]
  );
  return rows.length ? rowToUserTag(rows[0]) : 'not_found';
}

/**
 * Delete a tag from the user's candidate set.
 * Returns true if a row was deleted.
 * Never touches tastes.tags.
 */
export async function deleteUserTag(userId: string, id: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    'DELETE FROM user_tags WHERE id = $1 AND user_id = $2',
    [id, userId]
  );
  return (rowCount ?? 0) > 0;
}

// ── Plans & promo codes ──────────────────────────────────────────────────────

/** Count a user's tastes — used to enforce the free-tier record cap. */
export async function countTastes(userId: string): Promise<number> {
  const { rows } = await pool.query(
    'SELECT COUNT(*)::int AS n FROM tastes WHERE user_id = $1',
    [userId]
  );
  return rows[0]?.n ?? 0;
}

/** Set a user's plan directly (admin / seed path). Returns the updated user. */
export async function setUserPlan(userId: string, plan: Plan): Promise<User | null> {
  const { rows } = await pool.query(
    'UPDATE users SET plan = $2 WHERE id = $1 RETURNING *',
    [userId, plan]
  );
  return rows.length ? rowToUser(rows[0]) : null;
}

/** Look up a promo code by its canonical (normalized) form, or null. */
export async function getPromoCode(rawCode: string): Promise<PromoCodeRow | null> {
  const { rows } = await pool.query(
    'SELECT * FROM promo_codes WHERE code = $1',
    [normalizePromoCode(rawCode)]
  );
  return rows.length ? (rows[0] as PromoCodeRow) : null;
}

/** Outcome of a redemption attempt. `ok:false` carries a machine-readable reason
 *  matching the RedeemError union in @yon/shared. */
export type RedeemOutcome =
  | { ok: true; user: User }
  | { ok: false; error: 'invalid_code' | 'code_expired' | 'code_exhausted' | 'already_redeemed' };

/**
 * Redeem a promo code for a user, atomically. Locks the code row (FOR UPDATE)
 * so concurrent redemptions can't oversell a limited code, records the
 * redemption (the (code,user) UNIQUE makes a repeat a no-op → already_redeemed),
 * bumps used_count, and upgrades the user's plan to what the code grants.
 */
export async function redeemPromoCode(userId: string, rawCode: string): Promise<RedeemOutcome> {
  const code = normalizePromoCode(rawCode);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'SELECT * FROM promo_codes WHERE code = $1 FOR UPDATE',
      [code]
    );
    if (!rows.length) {
      await client.query('ROLLBACK');
      return { ok: false, error: 'invalid_code' };
    }
    const promo = rows[0] as PromoCodeRow;
    if (isPromoExpired(promo)) {
      await client.query('ROLLBACK');
      return { ok: false, error: 'code_expired' };
    }
    // A user who already redeemed this code gets `already_redeemed` regardless of
    // whether the code is now exhausted — their own prior redemption takes
    // precedence over the global uses-left check (which only gates NEW redeemers).
    // Without this, a single-use code self-redeemed twice would surface the
    // misleading `code_exhausted`.
    const existing = await client.query(
      'SELECT 1 FROM promo_redemptions WHERE code = $1 AND user_id = $2',
      [code, userId]
    );
    if (existing.rows.length) {
      await client.query('ROLLBACK');
      return { ok: false, error: 'already_redeemed' };
    }
    if (!promoHasUsesLeft(promo)) {
      await client.query('ROLLBACK');
      return { ok: false, error: 'code_exhausted' };
    }
    const ins = await client.query(
      `INSERT INTO promo_redemptions (code, user_id) VALUES ($1, $2)
       ON CONFLICT (code, user_id) DO NOTHING
       RETURNING id`,
      [code, userId]
    );
    if (!ins.rows.length) {
      // Lost a race to a concurrent redeem by the same user — still idempotent.
      await client.query('ROLLBACK');
      return { ok: false, error: 'already_redeemed' };
    }
    await client.query('UPDATE promo_codes SET used_count = used_count + 1 WHERE code = $1', [code]);
    const upd = await client.query(
      'UPDATE users SET plan = $2 WHERE id = $1 RETURNING *',
      [userId, promo.grants_plan]
    );
    await client.query('COMMIT');
    return { ok: true, user: rowToUser(upd.rows[0]) };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── Repurchase warning & purchases ledger ─────────────────────────────────────

/** Update the warnings_enabled flag for a user. Returns the updated User. */
export async function updateUserWarnings(
  userId: string,
  warningsEnabled: boolean
): Promise<User | null> {
  return updateUserSettings(userId, { warningsEnabled });
}

export async function updateUserSettings(
  userId: string,
  input: UpdateUserInput
): Promise<User | null> {
  const setClauses: string[] = [];
  const values: unknown[] = [userId];

  if (input.warningsEnabled !== undefined) {
    values.push(input.warningsEnabled);
    setClauses.push(`warnings_enabled = $${values.length}`);
  }
  if (input.locationEnabled !== undefined) {
    values.push(input.locationEnabled);
    setClauses.push(`location_enabled = $${values.length}`);
  }
  if (input.displayName !== undefined) {
    values.push(input.displayName);
    setClauses.push(`display_name = $${values.length}`);
  }
  if (input.defaultVisibility !== undefined) {
    values.push(input.defaultVisibility);
    setClauses.push(`default_visibility = $${values.length}`);
  }

  if (setClauses.length === 0) return findUserById(userId);

  const { rows } = await pool.query(
    `UPDATE users SET ${setClauses.join(', ')} WHERE id = $1 RETURNING *`,
    values
  );
  return rows.length ? rowToUser(rows[0]) : null;
}

/** Add a purchase entry to the ledger for a taste the user owns.
 *  Returns the new TastePurchase row. */
export async function addTastePurchase(
  userId: string,
  tasteId: string,
  input: { price?: string | null; place?: string | null }
): Promise<TastePurchase | null> {
  // Verify ownership first.
  const { rows: owned } = await pool.query(
    'SELECT id FROM tastes WHERE id = $1 AND user_id = $2',
    [tasteId, userId]
  );
  if (!owned.length) return null;

  const price = (() => {
    if (input.price == null || input.price.trim() === '') return null;
    const parsed = parseFloat(input.price.replace(/[^0-9.]/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
  })();
  const place =
    input.place != null && input.place.trim() !== ''
      ? input.place.trim()
      : null;

  const { rows } = await pool.query(
    `INSERT INTO taste_purchases (taste_id, price, place) VALUES ($1, $2, $3) RETURNING *`,
    [tasteId, price, place]
  );
  return rowToPurchase(rows[0]);
}

/** List all purchases for a taste the user owns, newest first. */
export async function listTastePurchases(
  userId: string,
  tasteId: string
): Promise<TastePurchase[] | null> {
  // Verify ownership.
  const { rows: owned } = await pool.query(
    'SELECT id FROM tastes WHERE id = $1 AND user_id = $2',
    [tasteId, userId]
  );
  if (!owned.length) return null;

  const { rows } = await pool.query(
    'SELECT * FROM taste_purchases WHERE taste_id = $1 ORDER BY created_at DESC',
    [tasteId]
  );
  return rows.map(rowToPurchase);
}

// ── S3a share / import ────────────────────────────────────────────────────────
// The share helpers live in share-db.ts (thin pointer + copy-on-import) but are
// re-exported here so route handlers import them from '@/lib/db' alongside
// getTaste/getRawImage — the single DB entry point the route layer mocks.
export {
  createShareToken,
  getShareToken,
  revokeShareToken,
  resolveImportCode,
  importSharedTaste,
  type ShareTokenRow,
  type ImportResult,
} from './share-db';
