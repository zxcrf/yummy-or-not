// GET /api/auth/oauth/[provider] — kick off a social login.
// Redirects the browser to the provider's authorize page (WeChat / Google /
// Apple). A short-lived `state` cookie guards against CSRF on the callback.
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { getProvider, isConfigured, buildAuthorizeUrl } from '@/lib/oauth';

type Ctx = { params: Promise<{ provider: string }> };

export async function GET(req: NextRequest, { params }: Ctx) {
  const { provider: id } = await params;
  const provider = getProvider(id);

  if (!provider || !isConfigured(provider)) {
    // Return a structured JSON error instead of bouncing to the now-deleted web
    // origin. The native AuthScreen checks p.configured before calling this
    // endpoint, but if it is ever reached the client receives a clear signal.
    return NextResponse.json(
      { error: 'provider_unavailable' },
      { status: 400 },
    );
  }

  const state = randomBytes(16).toString('hex');
  // The callback runs on THIS api origin (where the state cookie lives).
  const origin = req.nextUrl.origin;
  const redirectUri = `${origin}/api/auth/oauth/${id}/callback`;
  const res = NextResponse.redirect(buildAuthorizeUrl(provider, redirectUri, state));
  res.cookies.set(`yon_oauth_state_${id}`, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 600,
  });
  return res;
}
