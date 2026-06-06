// DB client singleton + typed query helpers for Yummy or Not.
// Uses a globalThis-cached Pool so Next.js hot reloads don't exhaust connections.
import { Pool, PoolClient } from 'pg';
import type { Taste, Stats, CreateTasteInput, UpdateTasteInput } from '@/lib/types';

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
    image:      row.image ?? '',
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

/** List tastes, optionally filtered by a search term and/or tag. Newest first. */
export async function listTastes({
  q,
  filter,
}: {
  q?: string;
  filter?: string;
} = {}): Promise<Taste[]> {
  const conditions: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const values: any[] = [];

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

/** Fetch a single taste by id; returns null if not found. */
export async function getTaste(id: string): Promise<Taste | null> {
  const { rows } = await pool.query('SELECT * FROM tastes WHERE id = $1', [id]);
  return rows.length ? rowToTaste(rows[0]) : null;
}

/** Insert a new taste, optionally overriding the image URL. Returns the created Taste. */
export async function createTaste(
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
    `INSERT INTO tastes (name, place, price, verdict, tags, notes, image)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [name, place, normalizedPrice, verdict, tags, notes, resolvedImage]
  );
  return rowToTaste(rows[0]);
}

/** Patch an existing taste; returns the updated Taste or null if not found. */
export async function updateTaste(
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
    return getTaste(id);
  }

  values.push(id);
  const sql = `UPDATE tastes SET ${setClauses.join(', ')} WHERE id = $${values.length} RETURNING *`;

  const { rows } = await pool.query(sql, values);
  return rows.length ? rowToTaste(rows[0]) : null;
}

/** Delete a taste by id; returns true if a row was deleted. */
export async function deleteTaste(id: string): Promise<boolean> {
  const { rowCount } = await pool.query('DELETE FROM tastes WHERE id = $1', [id]);
  return (rowCount ?? 0) > 0;
}

/** Compute aggregate stats across all tastes. */
export async function getStats(): Promise<Stats> {
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
  `);

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
