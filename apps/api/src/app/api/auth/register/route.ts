// POST /api/auth/register — email + password sign-up (international habit).
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { findUserByEmailWithHash, createUser, getPromoCode, redeemPromoCode } from '@/lib/db';
import { isPromoExpired, promoHasUsesLeft } from '@/lib/promo';
import {
  hashPassword,
  normalizeEmail,
  isValidEmail,
  establishSession,
} from '@/lib/auth';
import { withCors, corsPreflight } from '@/lib/cors';
import type { RegisterInput } from '@yon/shared';

export async function OPTIONS(req: NextRequest) {
  return corsPreflight(req.headers.get('origin'));
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get('origin');
  try {
    const { email: rawEmail, password, displayName, promoCode } = (await req.json()) as RegisterInput;
    const email = normalizeEmail(rawEmail ?? '');

    if (!isValidEmail(email)) {
      return withCors(NextResponse.json({ error: 'invalid_email' }, { status: 400 }), origin);
    }
    if (!password || password.length < 6) {
      return withCors(NextResponse.json({ error: 'weak_password' }, { status: 400 }), origin);
    }
    if (await findUserByEmailWithHash(email)) {
      return withCors(NextResponse.json({ error: 'email_taken' }, { status: 409 }), origin);
    }

    // If a promo code was supplied, validate it BEFORE creating the account so a
    // bad code doesn't leave behind an orphaned free user (which would then make
    // a retry fail with email_taken).
    const wantsPromo = !!promoCode?.trim();
    if (wantsPromo) {
      const promo = await getPromoCode(promoCode!);
      if (!promo) {
        return withCors(NextResponse.json({ error: 'invalid_code' }, { status: 400 }), origin);
      }
      if (isPromoExpired(promo)) {
        return withCors(NextResponse.json({ error: 'code_expired' }, { status: 400 }), origin);
      }
      if (!promoHasUsesLeft(promo)) {
        return withCors(NextResponse.json({ error: 'code_exhausted' }, { status: 400 }), origin);
      }
    }

    let user = await createUser({
      email,
      passwordHash: hashPassword(password),
      displayName: displayName?.trim() || email.split('@')[0],
    });

    // Redeem the (pre-validated) code to upgrade the fresh account. A rare race
    // (code exhausted between check and redeem) leaves the user on free — not
    // fatal, just logged — rather than blocking sign-up.
    if (wantsPromo) {
      const outcome = await redeemPromoCode(user.id, promoCode!);
      if (outcome.ok) user = outcome.user;
      else console.warn(`register: promo redeem for ${user.id} failed late: ${outcome.error}`);
    }

    return establishSession(req, user);
  } catch (err) {
    console.error('POST /api/auth/register error:', err);
    return withCors(NextResponse.json({ error: 'Internal server error' }, { status: 500 }), origin);
  }
}
