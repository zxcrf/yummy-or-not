// POST /api/promo/redeem — redeem a promo code on the signed-in account.
// Upgrades the user's plan to whatever the code grants (e.g. pro).
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { redeemPromoCode } from '@/lib/db';
import { getUserFromRequest } from '@/lib/auth';
import { withCors, corsPreflight } from '@/lib/cors';
import type { RedeemInput } from '@yon/shared';

export async function OPTIONS(req: NextRequest) {
  return corsPreflight(req.headers.get('origin'));
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get('origin');
  const user = await getUserFromRequest(req);
  if (!user) {
    return withCors(NextResponse.json({ error: 'unauthorized' }, { status: 401 }), origin);
  }
  try {
    const { code } = (await req.json()) as RedeemInput;
    if (!code?.trim()) {
      return withCors(NextResponse.json({ error: 'invalid_code' }, { status: 400 }), origin);
    }

    const outcome = await redeemPromoCode(user.id, code);
    if (!outcome.ok) {
      return withCors(NextResponse.json({ error: outcome.error }, { status: 400 }), origin);
    }
    return withCors(NextResponse.json({ user: outcome.user }), origin);
  } catch (err) {
    console.error('POST /api/promo/redeem error:', err);
    return withCors(NextResponse.json({ error: 'Internal server error' }, { status: 500 }), origin);
  }
}
