import {
  normalizePromoCode,
  generatePromoCode,
  isPromoExpired,
  promoHasUsesLeft,
  type PromoCodeRow,
} from '../promo';

/** Build a promo row with overridable fields (defaults: valid, 1 use, no expiry). */
function row(over: Partial<PromoCodeRow> = {}): PromoCodeRow {
  return {
    code: 'YON-PRO-AAAAAA',
    grants_plan: 'pro',
    max_uses: 1,
    used_count: 0,
    note: '',
    created_by: null,
    expires_at: null,
    created_at: '2026-01-01T00:00:00Z',
    ...over,
  };
}

describe('normalizePromoCode', () => {
  it('upper-cases, trims, and strips ALL inner whitespace so matching is exact', () => {
    expect(normalizePromoCode('  yon-pro a1 ')).toBe('YON-PROA1');
  });
  it('is idempotent on an already-canonical code', () => {
    expect(normalizePromoCode('YON-PRO-7F3KQ2')).toBe('YON-PRO-7F3KQ2');
  });
});

describe('generatePromoCode', () => {
  it('uses the prefix and a body of the requested length', () => {
    const code = generatePromoCode('YON-PRO', 6);
    expect(code.startsWith('YON-PRO-')).toBe(true);
    expect(code.slice('YON-PRO-'.length)).toHaveLength(6);
  });
  it('only emits unambiguous characters (no 0/O/1/I/L)', () => {
    const body = generatePromoCode('X', 64).slice(2); // strip "X-"
    expect(body).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]+$/);
  });
  it('survives normalization unchanged (already upper, no spaces)', () => {
    const code = generatePromoCode();
    expect(normalizePromoCode(code)).toBe(code);
  });
});

describe('isPromoExpired', () => {
  const now = new Date('2026-06-08T00:00:00Z');
  it('never expires when expires_at is null', () => {
    expect(isPromoExpired(row({ expires_at: null }), now)).toBe(false);
  });
  it('is expired when expires_at is strictly in the past', () => {
    expect(isPromoExpired(row({ expires_at: '2026-06-07T23:59:59Z' }), now)).toBe(true);
  });
  it('is not expired when expires_at is in the future', () => {
    expect(isPromoExpired(row({ expires_at: '2026-06-09T00:00:00Z' }), now)).toBe(false);
  });
});

describe('promoHasUsesLeft', () => {
  it('treats max_uses <= 0 as unlimited', () => {
    expect(promoHasUsesLeft(row({ max_uses: 0, used_count: 999 }))).toBe(true);
    expect(promoHasUsesLeft(row({ max_uses: -1, used_count: 999 }))).toBe(true);
  });
  it('has uses left while used_count < max_uses', () => {
    expect(promoHasUsesLeft(row({ max_uses: 3, used_count: 2 }))).toBe(true);
  });
  it('is exhausted once used_count reaches max_uses', () => {
    expect(promoHasUsesLeft(row({ max_uses: 3, used_count: 3 }))).toBe(false);
    expect(promoHasUsesLeft(row({ max_uses: 1, used_count: 1 }))).toBe(false);
  });
});
