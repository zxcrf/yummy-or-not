// S3a share-token helpers.
//
//   mintShareToken()  — crypto-random, non-enumerable, URL-safe token. Stored as
//                       the PRIMARY KEY of share_tokens and embedded in the deep
//                       link (`yummyornot://import/<token>`).
//   importCodeFor()   — the "magic word" downgrade path: a SHORT (6-char),
//                       token-DERIVED, deterministic code printed on the share
//                       card. WeChat-forwarded images strip the deep link, so the
//                       recipient can type/paste this code instead. Derived (not
//                       the raw token prefix) so it is non-enumerable yet the
//                       server can resolve code → token deterministically by
//                       re-deriving it for a candidate token.
//   shareDeepLink()   — the deep-link string built from a token.
//
// Both the token and the code stay platform/runtime-agnostic (Node crypto only).

import { randomBytes, createHash } from 'crypto';

/** A crypto-random, URL-safe, non-enumerable share token (256 bits).
 *  base64url (no '+', '/', '=') so it is a safe deep-link path segment. */
export function mintShareToken(): string {
  return randomBytes(32).toString('base64url');
}

// Unambiguous, alphanumeric alphabet for the printed import code. Drops the
// visually ambiguous 0/O and 1/I/L so a human re-typing the code off a card
// doesn't transpose them. 32 symbols → 6 chars ≈ 30 bits of address space.
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const CODE_LENGTH = 6;

/** Deterministically derive the short import code for a token.
 *  sha256(token) → map 6 bytes into the unambiguous alphabet. Deterministic so
 *  the server can resolve code → token (re-derive per candidate token); derived
 *  (hashed) so it is NOT the raw token prefix and not enumerable. */
export function importCodeFor(token: string): string {
  const digest = createHash('sha256').update(token).digest();
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += CODE_ALPHABET[digest[i] % CODE_ALPHABET.length];
  }
  return out;
}

/** Build the import deep link for a token. */
export function shareDeepLink(token: string): string {
  return `yummyornot://import/${token}`;
}
