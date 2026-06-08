// GET /api/auth/oauth/[provider] — kick off a social login.
// Redirects the browser to the provider's authorize page (WeChat / Google /
// Apple). A short-lived `state` cookie guards against CSRF on the callback.
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { getProvider, isConfigured, buildAuthorizeUrl } from '@/lib/oauth';

type Ctx = { params: Promise<{ provider: string }> };

/** Where to bounce the user back to (the app web origin), for the unavailable case. */
function appUrl(origin: string): string {
  return (process.env.APP_WEB_URL ?? origin).replace(/\/$/, '');
}

export async function GET(req: NextRequest, { params }: Ctx) {
  const { provider: id } = await params;
  const provider = getProvider(id);
  const origin = req.nextUrl.origin;

  if (!provider || !isConfigured(provider)) {
    // No credentials in this environment — bounce to the app with a clear flag
    // so the UI can explain instead of showing a broken provider page.
    return NextResponse.redirect(`${appUrl(origin)}/?auth_error=provider_unavailable`);
  }

  const state = randomBytes(16).toString('hex');
  // The callback runs on THIS api origin (where the state cookie lives).
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
