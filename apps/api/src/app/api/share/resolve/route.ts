// GET /api/share/resolve?code=<importCode> — the "magic word" downgrade path.
//
// WeChat-forwarded images strip the deep link, so the recipient types the short
// import code printed on the card. The code is a deterministic derivation of the
// token; we resolve it back to a live (non-revoked, unexpired) token so the
// client can then preview + import via the normal /api/share/<token> routes.
//
// 200 { token }
// 404 { error: 'share_gone' } — no live token derives to this code
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { withCors, corsPreflight } from '@/lib/cors';
import { clientIp, enforceRateLimits, rateLimitedResponse } from '@/lib/rate-limit';
import { resolveImportCode } from '@/lib/share-db';

export async function OPTIONS(req: NextRequest) {
  return corsPreflight(req.headers.get('origin'));
}

export async function GET(req: NextRequest) {
  const origin = req.headers.get('origin');

  // Anonymous brute-force guard: the import code is only ~30 bits, so an
  // unauthenticated attacker could otherwise grind the code space to preview/
  // import other users' shares. Cap per client IP (mirrors the OTP/login
  // routes). 10/min is generous for a human typing a code off a card.
  const limited = await enforceRateLimits([
    { scope: 'share:resolve:ip', identifier: clientIp(req), limit: 10, windowMs: 60 * 1000 },
  ]);
  if (limited.limited) return rateLimitedResponse(origin, limited.retryAfterSeconds);

  const code = (req.nextUrl.searchParams.get('code') ?? '').trim().toUpperCase();
  if (!code) {
    return withCors(NextResponse.json({ error: 'share_gone' }, { status: 404 }), origin);
  }

  try {
    const token = await resolveImportCode(code);
    if (!token) {
      return withCors(NextResponse.json({ error: 'share_gone' }, { status: 404 }), origin);
    }
    return withCors(NextResponse.json({ token }), origin);
  } catch (err) {
    console.error('GET /api/share/resolve error:', err);
    return withCors(NextResponse.json({ error: 'Internal server error' }, { status: 500 }), origin);
  }
}
