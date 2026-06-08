// CORS helper for the headless API.
// The app (Expo RN + RN Web) is a different origin from this API host, so every
// /api/** response needs CORS headers. Native clients send no Origin header;
// the browser (RN Web) does. We echo an allowed origin or fall back to "*" in dev.
//
// Env:
//   ALLOWED_ORIGIN  comma-separated allowlist of web origins, e.g.
//                   "https://yummy.example.com,http://localhost:8081".
//                   Unset/empty => permissive "*" (intended for dev only).
//
// The mobile build's EXPO_PUBLIC_API_URL points at this host; that env lives on
// the client side and does not affect CORS here.
import { NextResponse } from 'next/server';

const ALLOWLIST = (process.env.ALLOWED_ORIGIN ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

/** Resolve the Access-Control-Allow-Origin value for a given request Origin. */
function resolveAllowOrigin(origin: string | null): string {
  // No allowlist configured → permissive (dev).
  if (ALLOWLIST.length === 0) return '*';
  // Origin present and allowed → echo it (required when credentials/credentials-ish).
  if (origin && ALLOWLIST.includes(origin)) return origin;
  // Native clients (no Origin) or disallowed web origins → first allowed entry.
  return ALLOWLIST[0];
}

/** Standard CORS headers for a request, derived from its Origin. */
export function corsHeaders(origin: string | null): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': resolveAllowOrigin(origin),
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

/** Apply CORS headers to an existing NextResponse and return it. */
export function withCors<T>(res: NextResponse<T>, origin: string | null): NextResponse<T> {
  for (const [k, v] of Object.entries(corsHeaders(origin))) {
    res.headers.set(k, v);
  }
  return res;
}

/** Preflight (OPTIONS) response for any /api/** route. */
export function corsPreflight(origin: string | null): NextResponse {
  return new NextResponse(null, { status: 204, headers: corsHeaders(origin) });
}
