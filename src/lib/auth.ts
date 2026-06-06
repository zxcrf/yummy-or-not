// Auth primitives for Yummy or Not — password hashing, OTP codes, and
// server-side session cookies. Uses only Node's built-in `crypto` (no new deps).
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { getSessionUser, createSession } from '@/lib/db';
import type { User } from '@/lib/types';

// ── Cookie / session config ─────────────────────────────────────────────────

export const SESSION_COOKIE = 'yon_session';
/** Sessions live 30 days; refreshed implicitly by re-login. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** OTP codes are valid for 5 minutes. */
export const OTP_TTL_MS = 5 * 60 * 1000;

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

/** Attach the session cookie to a response. */
export function setSessionCookie(res: NextResponse, token: string): void {
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

/** Clear the session cookie (logout). */
export function clearSessionCookie(res: NextResponse): void {
  res.cookies.set(SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    path: '/',
    maxAge: 0,
  });
}

/**
 * Resolve the signed-in user for a request from its session cookie.
 * Returns null when there is no valid, unexpired session.
 */
export async function getUserFromRequest(req: NextRequest): Promise<User | null> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return getSessionUser(token);
}

/**
 * Create a fresh server-side session for `user` and return a JSON response with
 * the session cookie attached. Used by every endpoint that signs a user in.
 */
export async function establishSession(req: NextRequest, user: User): Promise<NextResponse> {
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await createSession(token, user.id, expiresAt, req.headers.get('user-agent') ?? '');
  const res = NextResponse.json({ user });
  setSessionCookie(res, token);
  return res;
}
