// Register-with-promo wiring tests.
//
// Pins the fix for the review BLOCK: a promo code supplied at sign-up that
// fails to redeem AFTER the account is created (the validate→redeem TOCTOU
// race) must be REPORTED in the response (`promo.ok=false` + error), not
// silently swallowed leaving the user on free. Also pins that a bad code is
// rejected BEFORE the account is created (no orphan), and that a good code is
// applied.
//
// The DB/auth/cors layers are mocked so the test isolates the route's control
// flow (the real redeem transaction is covered in lib/__tests__/promo-redeem).
import { NextRequest } from 'next/server';

jest.mock('@/lib/db', () => ({
  findUserByEmailWithHash: jest.fn(),
  createUser: jest.fn(),
  getPromoCode: jest.fn(),
  redeemPromoCode: jest.fn(),
}));

jest.mock('@/lib/auth', () => ({
  hashPassword: jest.fn(() => 'hash'),
  normalizeEmail: jest.fn((e: string) => e.toLowerCase()),
  isValidEmail: jest.fn(() => true),
  // Echo the merged body so we can assert what the route passed through.
  establishSession: jest.fn((_req: unknown, user: unknown, extra?: object) => {
    const { NextResponse } = require('next/server');
    return NextResponse.json({ user, token: 'tok', ...(extra ?? {}) });
  }),
}));

jest.mock('@/lib/cors', () => ({
  withCors: (res: unknown) => res,
  corsPreflight: () => {
    const { NextResponse } = require('next/server');
    return NextResponse.json({});
  },
}));

import { POST } from '@/app/api/auth/register/route';
import {
  findUserByEmailWithHash,
  createUser,
  getPromoCode,
  redeemPromoCode,
} from '@/lib/db';

const mockFind = findUserByEmailWithHash as jest.Mock;
const mockCreate = createUser as jest.Mock;
const mockGetPromo = getPromoCode as jest.Mock;
const mockRedeem = redeemPromoCode as jest.Mock;

const freeUser = (over: Record<string, unknown> = {}) => ({
  id: 'u1',
  displayName: 'a',
  phone: '',
  email: 'a@x.com',
  avatar: '',
  locale: 'zh',
  plan: 'free',
  createdAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

const validPromoRow = {
  code: 'YON-PRO-AAA',
  grants_plan: 'pro',
  max_uses: 5,
  used_count: 0,
  note: '',
  created_by: null,
  expires_at: null,
  created_at: new Date('2026-01-01T00:00:00Z'),
};

function reqOf(body: object) {
  return new NextRequest('http://localhost/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFind.mockResolvedValue(null); // email not taken
});

describe('POST /api/auth/register (promo)', () => {
  it('applies a valid promo code: account upgraded to pro, promo.ok=true', async () => {
    mockCreate.mockResolvedValue(freeUser());
    mockGetPromo.mockResolvedValue(validPromoRow);
    mockRedeem.mockResolvedValue({ ok: true, user: freeUser({ plan: 'pro' }) });

    const res = await POST(reqOf({ email: 'a@x.com', password: 'secret1', promoCode: 'yon-pro-aaa' }));
    const body = await res.json();

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockRedeem).toHaveBeenCalledWith('u1', 'yon-pro-aaa');
    expect(body.user.plan).toBe('pro');
    expect(body.promo).toEqual({ ok: true });
  });

  // The BLOCK regression: redeem fails AFTER createUser (validate→redeem race).
  it('does NOT silently drop to free when redeem fails late: account created, promo.ok=false reported', async () => {
    mockCreate.mockResolvedValue(freeUser());
    mockGetPromo.mockResolvedValue(validPromoRow); // passes pre-validation
    mockRedeem.mockResolvedValue({ ok: false, error: 'code_exhausted' }); // ...then loses the race

    const res = await POST(reqOf({ email: 'a@x.com', password: 'secret1', promoCode: 'yon-pro-aaa' }));
    const body = await res.json();

    expect(res.status).toBe(200); // sign-up still succeeds
    expect(mockCreate).toHaveBeenCalledTimes(1); // account WAS created
    expect(body.user.plan).toBe('free');
    expect(body.promo).toEqual({ ok: false, error: 'code_exhausted' }); // and the failure is surfaced
  });

  it('rejects a bad code BEFORE creating the account (no orphan)', async () => {
    mockGetPromo.mockResolvedValue(null); // unknown code

    const res = await POST(reqOf({ email: 'a@x.com', password: 'secret1', promoCode: 'NOPE' }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('invalid_code');
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockRedeem).not.toHaveBeenCalled();
  });

  it('plain sign-up (no code) omits the promo field and never touches redeem', async () => {
    mockCreate.mockResolvedValue(freeUser());

    const res = await POST(reqOf({ email: 'a@x.com', password: 'secret1' }));
    const body = await res.json();

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockGetPromo).not.toHaveBeenCalled();
    expect(mockRedeem).not.toHaveBeenCalled();
    expect(body.promo).toBeUndefined();
    expect(body.user.plan).toBe('free');
  });
});
