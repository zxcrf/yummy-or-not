// Auth primitives for Yummy or Not — password hashing, OTP codes, and
// server-side sessions. Uses only Node's built-in `crypto` (no new deps).
//
// Transport: the app is a DIFFERENT origin from this API host, so a same-origin
// cookie is not enough (native clients have no cookie jar). Every sign-in
// returns the opaque session token in the JSON body; the client stores it and
// sends `Authorization: Bearer <token>`. We ALSO set an httpOnly cookie so the
// web build works without touching storage, and accept either transport on read.
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { getSessionUser, createSession } from '@/lib/db';
import { withCors } from '@/lib/cors';
import type { User } from '@yon/shared';

// ── Cookie / session config ─────────────────────────────────────────────────

export const SESSION_COOKIE = 'yon_session';
/** Sessions live 30 days; refreshed implicitly by re-login. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** OTP codes are valid for 5 minutes. */
export const OTP_TTL_MS = 5 * 60 * 1000;
/** Email password-reset tokens are valid for 30 minutes. */
export const PW_RESET_TTL_MS = 30 * 60 * 1000;

// ── Password hashing (scrypt) ────────────────────────────────────────────────

/** Hash a plaintext password → "salt:hash" (both hex). */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

/** Constant-time verify a password against a stored "salt:hash". */
export function verifyPassword(password: string, stored: string | null): boolean {
  if (!stored) return false;
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = scryptSync(password, salt, 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

// ── One-time codes (SMS OTP) ─────────────────────────────────────────────────

/** Generate a random 6-digit numeric code. */
export function generateOtp(): string {
  return String(randomBytes(4).readUInt32BE(0) % 1_000_000).padStart(6, '0');
}

/** sha256 of a code — we never persist the raw code. */
export function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

/** A long opaque session token (256 bits). */
export function generateSessionToken(): string {
  return randomBytes(32).toString('hex');
}

/** A high-entropy raw password-reset token (256 bits). Only its hashCode() is
 *  ever stored; the raw value is mailed to the user. */
export function generateResetToken(): string {
  return randomBytes(32).toString('hex');
}

// ── Input normalization / validation ─────────────────────────────────────────

/** Normalize a phone number to a comparable form. Keeps a leading '+'. */
export function normalizePhone(raw: string): string {
  const trimmed = raw.trim();
  const plus = trimmed.startsWith('+');
  const digits = trimmed.replace(/[^0-9]/g, '');
  return (plus ? '+' : '') + digits;
}

/** Loose phone sanity check: 7–15 digits (optionally +). */
export function isValidPhone(phone: string): boolean {
  return /^\+?[0-9]{7,15}$/.test(phone);
}

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ── Session cookie helpers ───────────────────────────────────────────────────

const isProd = process.env.NODE_ENV === 'production';

/** Attach the session cookie to a response.
 *  sameSite 'none' + secure in prod so the cookie survives the cross-origin
 *  web setup (app and API on different hosts); 'lax' in dev (http://localhost). */
export function setSessionCookie(res: NextResponse, token: string): void {
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: isProd ? 'none' : 'lax',
    secure: isProd,
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

/** Clear the session cookie (logout). */
export function clearSessionCookie(res: NextResponse): void {
  res.cookies.set(SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: isProd ? 'none' : 'lax',
    secure: isProd,
    path: '/',
    maxAge: 0,
  });
}

/** Pull the bearer token from a request: Authorization header first, then cookie. */
export function tokenFromRequest(req: NextRequest): string | null {
  const auth = req.headers.get('authorization');
  if (auth && auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim() || null;
  }
  return req.cookies.get(SESSION_COOKIE)?.value ?? null;
}

/**
 * Resolve the signed-in user for a request from its bearer token / cookie.
 * Returns null when there is no valid, unexpired session.
 */
export async function getUserFromRequest(req: NextRequest): Promise<User | null> {
  const token = tokenFromRequest(req);
  if (!token) return null;
  return getSessionUser(token);
}

/**
 * Create a fresh server-side session for `user` and return a CORS-wrapped JSON
 * response carrying { user, token } (bearer) with the session cookie attached.
 * `extra` lets a caller merge additional top-level fields into the body (e.g.
 * register attaches the promo-redemption outcome) without changing the session
 * mechanics. Used by every endpoint that signs a user in.
 */
export async function establishSession(
  req: NextRequest,
  user: User,
  extra?: Record<string, unknown>
): Promise<NextResponse> {
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await createSession(token, user.id, expiresAt, req.headers.get('user-agent') ?? '');
  const res = NextResponse.json({ user, token, ...extra });
  setSessionCookie(res, token);
  return withCors(res, req.headers.get('origin'));
}
