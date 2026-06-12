// GET /api/auth/oauth/[provider]/callback — finish a social login.
// Validates the CSRF `state`, exchanges the code for a profile, resolves it to a
// user (creating/linking as needed), starts a session, and redirects back to the
// native app via a deep link.
//
// The token is delivered via the deep-link URL so AuthScreen's
// WebBrowser.openAuthSessionAsync() can intercept the redirect and extract the
// token from the returned URL:
//   yummyornot://auth/callback?token=<token>
//   yummyornot://auth/callback?auth_error=<reason>
//
// APP_NATIVE_SCHEME — the Expo app's custom URI scheme (default: "yummyornot").
// Set this in the API's environment to match the `scheme` in app.json.
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { getProvider, isConfigured, exchangeCode } from '@/lib/oauth';
import { findOrCreateUserByOAuth, createSession } from '@/lib/db';
import { generateSessionToken, setSessionCookie, SESSION_TTL_MS } from '@/lib/auth';

type Ctx = { params: Promise<{ provider: string }> };

/** Deep-link base URL for the native app (e.g. "yummyornot://auth/callback"). */
function nativeCallbackBase(): string {
  const scheme = (process.env.APP_NATIVE_SCHEME ?? 'yummyornot').replace(/\/$/, '');
  return `${scheme}://auth/callback`;
}

export async function GET(req: NextRequest, { params }: Ctx) {
  const { provider: id } = await params;
  const origin = req.nextUrl.origin;
  const callbackBase = nativeCallbackBase();
  const fail = (reason: string) =>
    NextResponse.redirect(`${callbackBase}?auth_error=${reason}`);

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
    // Redirect to the native deep link. WebBrowser.openAuthSessionAsync() on the
    // client intercepts this redirect (the URL matches the registered app scheme)
    // and returns it as the session result without following the redirect in the
    // browser — so the bearer token never appears in server logs as an HTTP request.
    const res = NextResponse.redirect(`${callbackBase}?token=${token}`);
    setSessionCookie(res, token);
    res.cookies.set(`yon_oauth_state_${id}`, '', { path: '/', maxAge: 0 });
    return res;
  } catch (err) {
    console.error(`oauth callback (${id}) error:`, err);
    return fail('oauth_failed');
  }
}
