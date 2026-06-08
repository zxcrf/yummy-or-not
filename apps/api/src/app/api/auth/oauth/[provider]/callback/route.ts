// GET /api/auth/oauth/[provider]/callback — finish a social login.
// Validates the CSRF `state`, exchanges the code for a profile, resolves it to a
// user (creating/linking as needed), starts a session, and redirects back to the
// app web origin. Because the app is a different origin from this API, the bearer
// token is delivered in the URL fragment (#token=…) for the web client to pick up
// and persist; the cookie is also set for the same-origin case. (Native deep-link
// return is not wired yet — web-first.)
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { getProvider, isConfigured, exchangeCode } from '@/lib/oauth';
import { findOrCreateUserByOAuth, createSession } from '@/lib/db';
import { generateSessionToken, setSessionCookie, SESSION_TTL_MS } from '@/lib/auth';

type Ctx = { params: Promise<{ provider: string }> };

/** The app web origin to return the user to (defaults to this API origin in dev). */
function appUrl(origin: string): string {
  return (process.env.APP_WEB_URL ?? origin).replace(/\/$/, '');
}

export async function GET(req: NextRequest, { params }: Ctx) {
  const { provider: id } = await params;
  const origin = req.nextUrl.origin;
  const app = appUrl(origin);
  const fail = (reason: string) =>
    NextResponse.redirect(`${app}/?auth_error=${reason}`);

  const provider = getProvider(id);
  if (!provider || !isConfigured(provider)) return fail('provider_unavailable');

  const code = req.nextUrl.searchParams.get('code');
  const state = req.nextUrl.searchParams.get('state');
  const expectedState = req.cookies.get(`yon_oauth_state_${id}`)?.value;
  if (!code || !state || state !== expectedState) return fail('oauth_state');

  try {
    const redirectUri = `${origin}/api/auth/oauth/${id}/callback`;
    const profile = await exchangeCode(provider, code, redirectUri);
    const user = await findOrCreateUserByOAuth(id, profile);

    const token = generateSessionToken();
    await createSession(
      token,
      user.id,
      new Date(Date.now() + SESSION_TTL_MS),
      req.headers.get('user-agent') ?? ''
    );
    // Deliver the token in the fragment so a cross-origin web SPA can read it
    // from location.hash without it ever hitting the server logs as a query.
    const res = NextResponse.redirect(`${app}/#token=${token}`);
    setSessionCookie(res, token);
    res.cookies.set(`yon_oauth_state_${id}`, '', { path: '/', maxAge: 0 });
    return res;
  } catch (err) {
    console.error(`oauth callback (${id}) error:`, err);
    return fail('oauth_failed');
  }
}
