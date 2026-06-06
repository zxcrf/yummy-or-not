// GET /api/auth/oauth/[provider]/callback — finish a social login.
// Validates the CSRF `state`, exchanges the code for a profile, resolves it to a
// user (creating/linking as needed), starts a session, and redirects home.
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { getProvider, isConfigured, exchangeCode } from '@/lib/oauth';
import { findOrCreateUserByOAuth, createSession } from '@/lib/db';
import { generateSessionToken, setSessionCookie, SESSION_TTL_MS } from '@/lib/auth';

type Ctx = { params: Promise<{ provider: string }> };

export async function GET(req: NextRequest, { params }: Ctx) {
  const { provider: id } = await params;
  const origin = req.nextUrl.origin;
  const fail = (reason: string) =>
    NextResponse.redirect(`${origin}/?auth_error=${reason}`);

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
    const res = NextResponse.redirect(origin + '/');
    setSessionCookie(res, token);
    res.cookies.set(`yon_oauth_state_${id}`, '', { path: '/', maxAge: 0 });
    return res;
  } catch (err) {
    console.error(`oauth callback (${id}) error:`, err);
    return fail('oauth_failed');
  }
}
