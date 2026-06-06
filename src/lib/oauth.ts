// OAuth/social-login registry for Yummy or Not.
//
// Two habits, three providers:
//   • WeChat (微信)  — the domestic default.
//   • Google, Apple  — the international defaults.
//
// Each provider is configured purely from env vars, so the same code path lights
// up in production once credentials are present. With no credentials a provider
// reports `configured: false` and the UI hides / disables its button, and the
// API returns a clear 501 instead of a broken redirect.
import type { OAuthProvider } from '@/lib/types';

export interface ProviderProfile {
  /** Stable unique id from the provider. */
  uid: string;
  displayName: string;
  email?: string;
  avatar?: string;
}

interface ProviderConfig {
  id: OAuthProvider;
  label: string;
  /** "domestic" buttons surface for China; "international" for everyone else. */
  audience: 'domestic' | 'international';
  clientId?: string;
  clientSecret?: string;
  authorizeUrl: string;
  tokenUrl: string;
  userInfoUrl?: string;
  scope: string;
  /** Some providers (WeChat) name the client param `appid` instead of `client_id`. */
  clientIdParam: string;
}

function cfg(env: NodeJS.ProcessEnv): Record<OAuthProvider, ProviderConfig> {
  return {
    wechat: {
      id: 'wechat',
      label: 'WeChat',
      audience: 'domestic',
      clientId: env.WECHAT_APP_ID,
      clientSecret: env.WECHAT_APP_SECRET,
      authorizeUrl: 'https://open.weixin.qq.com/connect/qrconnect',
      tokenUrl: 'https://api.weixin.qq.com/sns/oauth2/access_token',
      userInfoUrl: 'https://api.weixin.qq.com/sns/userinfo',
      scope: 'snsapi_login',
      clientIdParam: 'appid',
    },
    google: {
      id: 'google',
      label: 'Google',
      audience: 'international',
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      userInfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
      scope: 'openid email profile',
      clientIdParam: 'client_id',
    },
    apple: {
      id: 'apple',
      label: 'Apple',
      audience: 'international',
      clientId: env.APPLE_CLIENT_ID,
      // Apple's "secret" is a signed JWT generated from a private key; when that
      // is provided (APPLE_CLIENT_SECRET) the generic exchange below applies.
      clientSecret: env.APPLE_CLIENT_SECRET,
      authorizeUrl: 'https://appleid.apple.com/auth/authorize',
      tokenUrl: 'https://appleid.apple.com/auth/token',
      scope: 'name email',
      clientIdParam: 'client_id',
    },
  };
}

export function getProvider(id: string): ProviderConfig | null {
  const all = cfg(process.env);
  return (all as Record<string, ProviderConfig>)[id] ?? null;
}

export function isConfigured(p: ProviderConfig): boolean {
  return Boolean(p.clientId && p.clientSecret);
}

/** Public, secret-free summary the client uses to decide which buttons to show. */
export function listProviderStatus(): {
  id: OAuthProvider;
  label: string;
  audience: 'domestic' | 'international';
  configured: boolean;
}[] {
  const all = cfg(process.env);
  return (Object.values(all) as ProviderConfig[]).map((p) => ({
    id: p.id,
    label: p.label,
    audience: p.audience,
    configured: isConfigured(p),
  }));
}

/** Build the provider's authorize URL to redirect the browser to. */
export function buildAuthorizeUrl(
  p: ProviderConfig,
  redirectUri: string,
  state: string
): string {
  const params = new URLSearchParams({
    [p.clientIdParam]: p.clientId ?? '',
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: p.scope,
    state,
  });
  // WeChat requires #wechat_redirect at the end of the QR-connect URL.
  const hash = p.id === 'wechat' ? '#wechat_redirect' : '';
  return `${p.authorizeUrl}?${params.toString()}${hash}`;
}

/**
 * Exchange an authorization `code` for a normalized profile.
 * Generic OAuth2 flow; per-provider field mapping below. Network calls only
 * happen here, at callback time.
 */
export async function exchangeCode(
  p: ProviderConfig,
  code: string,
  redirectUri: string
): Promise<ProviderProfile> {
  const body = new URLSearchParams({
    [p.clientIdParam]: p.clientId ?? '',
    [p.id === 'wechat' ? 'secret' : 'client_secret']: p.clientSecret ?? '',
    code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
  });

  const tokenRes = await fetch(p.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
  });
  const token = await tokenRes.json();
  if (!tokenRes.ok || token.error) {
    throw new Error(`token exchange failed: ${token.error ?? tokenRes.status}`);
  }

  // WeChat returns openid + access_token together and needs a second userinfo call.
  if (p.id === 'wechat') {
    const u = new URL(p.userInfoUrl!);
    u.searchParams.set('access_token', token.access_token);
    u.searchParams.set('openid', token.openid);
    const profRes = await fetch(u);
    const prof = await profRes.json();
    return {
      uid: token.unionid ?? token.openid,
      displayName: prof.nickname ?? 'WeChat user',
      avatar: prof.headimgurl ?? '',
    };
  }

  // OIDC providers (Google, Apple) carry an id_token; Google also exposes userinfo.
  if (p.userInfoUrl) {
    const profRes = await fetch(p.userInfoUrl, {
      headers: { Authorization: `Bearer ${token.access_token}` },
    });
    const prof = await profRes.json();
    return {
      uid: prof.sub ?? prof.id,
      displayName: prof.name ?? prof.email ?? 'User',
      email: prof.email,
      avatar: prof.picture ?? '',
    };
  }

  // Fallback: decode the id_token (JWT) payload for sub/email (Apple).
  const claims = decodeJwtClaims(token.id_token);
  return {
    uid: claims.sub,
    displayName: claims.email ?? 'Apple user',
    email: claims.email,
  };
}

// Minimal, unverified JWT payload decode (claims only). Signature is implicitly
// trusted because the token came straight from the provider's token endpoint.
function decodeJwtClaims(jwt: string): { sub: string; email?: string } {
  const payload = jwt.split('.')[1] ?? '';
  const json = Buffer.from(payload, 'base64url').toString('utf8');
  return JSON.parse(json);
}
