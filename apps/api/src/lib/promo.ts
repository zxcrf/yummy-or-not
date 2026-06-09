// Promo-code helpers — pure functions (no DB) so they're trivially unit-testable.
// The DB-touching redemption lives in db.ts (redeemPromoCode); this module owns
// code normalization, generation, and the validity predicates both share.
import { randomBytes } from 'crypto';
import type { Plan } from '@yon/shared';

/** A promo_codes row as stored in Postgres (snake_case, raw types). */
export interface PromoCodeRow {
  code: string;
  grants_plan: Plan;
  /** ≤ 0 means unlimited uses. */
  max_uses: number;
  used_count: number;
  note: string;
  created_by: string | null;
  /** null means never expires. */
  expires_at: string | Date | null;
  created_at: string | Date;
}

// Unambiguous alphabet: no 0/O, 1/I/L to keep codes easy to read aloud / retype.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Normalize user-entered codes to the canonical stored form: trimmed,
 *  upper-cased, inner whitespace stripped. Matching is exact on this form. */
export function normalizePromoCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, '');
}

/** Generate a fresh code like "YON-PRO-7F3KQ2". `groupLen` random chars from the
 *  unambiguous alphabet. Format is normalize()-stable (already upper, no spaces). */
export function generatePromoCode(prefix = 'YON-PRO', groupLen = 6): string {
  const bytes = randomBytes(groupLen);
  let body = '';
  for (let i = 0; i < groupLen; i++) {
    body += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return `${prefix}-${body}`;
}

/** True when the code is past its expiry. Never-expiring codes are never expired. */
export function isPromoExpired(row: PromoCodeRow, now: Date = new Date()): boolean {
  if (!row.expires_at) return false;
  return new Date(row.expires_at).getTime() < now.getTime();
}

/** True when the code still has redemptions left (max_uses ≤ 0 = unlimited). */
export function promoHasUsesLeft(row: PromoCodeRow): boolean {
  if (row.max_uses <= 0) return true;
  return row.used_count < row.max_uses;
}
