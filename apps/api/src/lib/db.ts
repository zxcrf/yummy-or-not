// DB client singleton + typed query helpers for Yummy or Not.
// Uses a globalThis-cached Pool so Next.js hot reloads don't exhaust connections.
import { createHash } from 'crypto';
import { Pool } from 'pg';
import type { Taste, Stats, CreateTasteInput, UpdateTasteInput, User, Plan, UserTag } from '@yon/shared';
import { FILTERS } from '@yon/shared';
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

/** Map a DB row (snake_case) to a Taste (camelCase). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function rowToTaste(row: any): Promise<Taste> {
  const urls = await resolvePhotoUrls(row.image);
  return {
    id:          row.id,
    name:        row.name,
    place:       row.place ?? '',
    price:       row.price ?? '',
    verdict:     row.verdict,
    tags:        (row.tags ?? []).flatMap((t: string) => normalizeTag(t)),
    boughtCount: Number(row.bought_count),
    date:        relativeDate(new Date(row.created_at)),
    notes:       row.notes ?? '',
    image:       urls.image,
    imageThumb:  urls.imageThumb,
    imageDisplay: urls.imageDisplay,
    imageKey:    imageKeyFromRow(row.image),
    createdAt:   new Date(row.created_at).toISOString(),
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

/** List a user's tastes, optionally filtered by a search term and/or tag. Newest first. */
export async function listTastes(
  userId: string,
  {
    q,
    filter,
  }: {
    q?: string;
    filter?: string;
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

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const sql = `SELECT * FROM tastes ${where} ORDER BY created_at DESC`;

  const { rows } = await pool.query(sql, values);
  return Promise.all(rows.map(rowToTaste));
}

/** Fetch a single taste owned by the user; returns null if not found. */
export async function getTaste(userId: string, id: string): Promise<Taste | null> {
  const { rows } = await pool.query(
    'SELECT * FROM tastes WHERE id = $1 AND user_id = $2',
    [id, userId]
  );
  return rows.length ? await rowToTaste(rows[0]) : null;
}

/** Insert a new taste owned by the user, optionally overriding the image URL. */
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
  } = input;

  const resolvedImage = imageUrl ?? image;
  const normalizedPrice = normalizePrice(price);

  const { rows } = await pool.query(
    `INSERT INTO tastes (user_id, name, place, price, verdict, tags, notes, image)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [userId, name, place, normalizedPrice, verdict, tags, notes, resolvedImage]
  );
  return await rowToTaste(rows[0]);
}

/** Patch a taste owned by the user; returns the updated Taste or null if not found. */
export async function updateTaste(
  userId: string,
  id: string,
  patch: UpdateTasteInput
): Promise<Taste | null> {
  // Build SET clauses dynamically from provided fields.
  const setClauses: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const values: any[] = [];

  // NOTE: `image` is intentionally NOT updatable here. The image column is owned
  // by the upload pipeline (POST /api/tastes assigns server-generated keys). If a
  // client could PATCH `image` to an arbitrary bare key, it could point at another
  // user's object and mint a presigned original via /original (IDOR). Keep image
  // out of the patch surface entirely.
  const fieldMap: Record<string, string> = {
    name:    'name',
    place:   'place',
    price:   'price',
    verdict: 'verdict',
    tags:    'tags',
    notes:   'notes',
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

  if (patch.incrementBought) {
    values.push(patch.incrementBought);
    setClauses.push(`bought_count = bought_count + $${values.length}`);
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
  return rows.length ? await rowToTaste(rows[0]) : null;
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
    WHERE user_id = $1
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

// ── Users & auth ────────────────────────────────────────────────────────────

/** Map a users row → the client-safe User (never includes password_hash). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToUser(row: any): User {
  return {
    id:          row.id,
    displayName: row.display_name ?? '',
    phone:       row.phone ?? '',
    email:       row.email ?? '',
    avatar:      row.avatar ?? '',
    locale:      row.locale ?? 'zh',
    plan:        row.plan ?? 'free',
    createdAt:   new Date(row.created_at).toISOString(),
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
  return rowToUser(rows[0]);
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
