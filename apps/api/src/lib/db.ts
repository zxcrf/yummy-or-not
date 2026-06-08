// DB client singleton + typed query helpers for Yummy or Not.
// Uses a globalThis-cached Pool so Next.js hot reloads don't exhaust connections.
import { Pool } from 'pg';
import type { Taste, Stats, CreateTasteInput, UpdateTasteInput, User } from '@yon/shared';
import type { ProviderProfile } from './oauth';
import { getPhotoPublicBaseUrl } from './env';

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

/** Resolve a stored `image` value into a ready-to-render URL.
 *  - falsy            → ''
 *  - http(s):// …     → as-is (seed rows, blob full URLs, absolute legacy URLs)
 *  - /uploads/ …      → as-is (legacy local paths)
 *  - otherwise        → bare key, rendered as `${PHOTO_PUBLIC_BASE_URL}/${key}` */
export function resolvePhotoUrl(image: string | null | undefined): string {
  if (!image) return '';
  if (
    image.startsWith('http://') ||
    image.startsWith('https://') ||
    image.startsWith('/uploads/')
  ) {
    return image;
  }
  const base = getPhotoPublicBaseUrl();
  const key = image.replace(/^\//, '');
  return base ? `${base}/${key}` : `/${key}`;
}

/** Map a DB row (snake_case) to a Taste (camelCase). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToTaste(row: any): Taste {
  return {
    id:         row.id,
    name:       row.name,
    place:      row.place ?? '',
    price:      row.price ?? '',
    verdict:    row.verdict,
    tags:       (row.tags ?? []).flatMap((t: string) => normalizeTag(t)),
    boughtCount: Number(row.bought_count),
    date:       relativeDate(new Date(row.created_at)),
    notes:      row.notes ?? '',
    image:      resolvePhotoUrl(row.image),
    createdAt:  new Date(row.created_at).toISOString(),
  };
}

/** Parse a price string like "$5.80" → 5.80, returning 0 on failure. */
function parsePrice(price: string): number {
  const n = parseFloat(price.replace(/[^0-9.]/g, ''));
  return isNaN(n) ? 0 : n;
}

/** Normalize a price string to "$x.yy" format on write.
 *  Strips non-numeric chars; if it parses as a number returns "$n.toFixed(2)".
 *  Leaves non-numeric strings (e.g. "—") untouched. Empty → "". */
function normalizePrice(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const digits = trimmed.replace(/[^0-9.]/g, '');
  const n = parseFloat(digits);
  if (!isNaN(n)) return `$${n.toFixed(2)}`;
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
  return rows.map(rowToTaste);
}

/** Fetch a single taste owned by the user; returns null if not found. */
export async function getTaste(userId: string, id: string): Promise<Taste | null> {
  const { rows } = await pool.query(
    'SELECT * FROM tastes WHERE id = $1 AND user_id = $2',
    [id, userId]
  );
  return rows.length ? rowToTaste(rows[0]) : null;
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
  return rowToTaste(rows[0]);
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

  const fieldMap: Record<string, string> = {
    name:    'name',
    place:   'place',
    price:   'price',
    verdict: 'verdict',
    tags:    'tags',
    notes:   'notes',
    image:   'image',
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
  return rows.length ? rowToTaste(rows[0]) : null;
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
}): Promise<User> {
  const { rows } = await pool.query(
    `INSERT INTO users (display_name, phone, email, password_hash, avatar, locale)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      input.displayName ?? '',
      input.phone ?? null,
      input.email ?? null,
      input.passwordHash ?? null,
      input.avatar ?? '',
      input.locale ?? 'zh',
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
    'INSERT INTO sessions (token, user_id, expires_at, user_agent) VALUES ($1, $2, $3, $4)',
    [token, userId, expiresAt, userAgent]
  );
}

/** Resolve a session token → its (unexpired) user, or null. */
export async function getSessionUser(token: string): Promise<User | null> {
  const { rows } = await pool.query(
    `SELECT u.* FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token = $1 AND s.expires_at > now()`,
    [token]
  );
  return rows.length ? rowToUser(rows[0]) : null;
}

export async function deleteSession(token: string): Promise<void> {
  await pool.query('DELETE FROM sessions WHERE token = $1', [token]);
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
