// Unit tests for the S3a share-token helpers (lib/share-token.ts — NOT yet
// implemented, so these FAIL now and PASS once S3a lands):
//
//   - mintShareToken()  : crypto-random, non-enumerable token
//   - importCodeFor()   : SHORT (6–8 char), token-DERIVED, deterministic code
//   - the deepLink shape (yummyornot://import/<token>)
//
// These pin the "magic word" downgrade path described in §S3a: the import code
// is printed on the card so WeChat-forwarded images (which strip the deep link)
// still carry a way to import. It must be derived from the token (so the server
// can resolve code → token) yet short and non-enumerable.

import { mintShareToken, importCodeFor, shareDeepLink } from '@/lib/share-token';

describe('mintShareToken — non-enumerable token', () => {
  it('returns a long, URL-safe, crypto-random token', () => {
    const a = mintShareToken();
    const b = mintShareToken();
    expect(typeof a).toBe('string');
    // Long enough to be non-enumerable (>= 128 bits of entropy ≈ 22+ b64url chars).
    expect(a.length).toBeGreaterThanOrEqual(20);
    // URL-safe: no '+', '/', or '=' that would break the deep link path segment.
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    // Two mints never collide.
    expect(a).not.toBe(b);
  });
});

describe('importCodeFor — short, token-derived, deterministic', () => {
  it('is 6–8 chars and deterministic for a given token', () => {
    const token = 'tok_abcdefghijklmnopqrstuvwxyz';
    const code1 = importCodeFor(token);
    const code2 = importCodeFor(token);
    expect(code1).toBe(code2); // deterministic (server resolves code → token)
    expect(code1.length).toBeGreaterThanOrEqual(6);
    expect(code1.length).toBeLessThanOrEqual(8);
  });

  it('uses an unambiguous, non-enumerable alphabet (no full sequential range)', () => {
    const token = 'tok_zzzzzzzzzzzzzzzzzzzzzzzzzz';
    const code = importCodeFor(token);
    // Code is not just the raw token prefix (must be derived/hashed).
    expect(token.startsWith(code)).toBe(false);
    // Code is alphanumeric (printable on the card).
    expect(code).toMatch(/^[A-Za-z0-9]+$/);
  });

  it('different tokens map to different codes (low collision)', () => {
    const codes = new Set(
      Array.from({ length: 200 }, (_, i) => importCodeFor(`tok_${i}_${'x'.repeat(20)}`)),
    );
    // No catastrophic collapse — distinct tokens overwhelmingly yield distinct codes.
    expect(codes.size).toBeGreaterThan(190);
  });
});

describe('shareDeepLink — yummyornot://import/<token>', () => {
  it('builds the import deep link from the token', () => {
    expect(shareDeepLink('tok123')).toBe('yummyornot://import/tok123');
  });
});
