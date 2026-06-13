// GET /i/<importCode> — the WeChat "识别图中二维码" landing page (S3a 可导入).
//
// The importable share card prints a QR encoding https://<host>/i/<importCode>.
// When a recipient scans it (e.g. WeChat 识别图中二维码) their browser opens THIS
// route. There are NO page routes in this Next app (it is API-route-only), so
// this is a Route Handler that returns a real HTML document — without it the QR
// would land on a 404.
//
// It resolves the printed code → a live token using the SAME resolver the
// existing GET /api/share/resolve route uses (no new backend logic), then serves
// a tiny HTML page that bounces into the app via the deep link
// (yummyornot://import/<token>) and offers a manual "open" button. On a dead /
// expired code it serves a friendly 404 page rather than a blank error.
//
// 200 text/html — live code → import landing (auto deep-link + manual button)
// 404 text/html — no live token derives to this code (expired / revoked)
// 429          — per-IP rate limited (shared brute-force guard with /api/share/resolve)
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { clientIp, enforceRateLimits, rateLimitedResponse } from '@/lib/rate-limit';
import { resolveImportCode } from '@/lib/share-db';
import { shareDeepLink } from '@/lib/share-token';

type RouteContext = { params: Promise<{ code: string }> };

// Minimal HTML escape so a (resolved) token or code can never break out of the
// document context. Tokens are base64url and codes are alphanumeric, so this is
// belt-and-braces, but the landing page is public so we keep it strict.
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function htmlResponse(body: string, status: number): NextResponse {
  return new NextResponse(body, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // The landing is per-token and short-lived; don't let a CDN cache a stale
      // (or expired) resolution.
      'Cache-Control': 'no-store',
    },
  });
}

function gonePage(code: string): string {
  return `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Yummy or Not</title>
<style>
  body { margin:0; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
         background:#fff; color:#191017; display:flex; min-height:100vh;
         align-items:center; justify-content:center; padding:24px; }
  .card { max-width:360px; text-align:center; }
  h1 { font-size:20px; margin:0 0 8px; }
  p { color:#7a6d76; font-size:14px; line-height:1.5; margin:0; }
  .code { margin-top:16px; font-weight:800; letter-spacing:4px; }
</style>
</head>
<body>
  <div class="card">
    <h1>分享已失效</h1>
    <p>这个口令对应的分享已经过期或被撤回。请让对方在 Yummy or Not 里重新分享一次。</p>
    <p class="code">${esc(code)}</p>
  </div>
</body>
</html>`;
}

function landingPage(code: string, token: string): string {
  const deepLink = shareDeepLink(token);
  return `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Yummy or Not</title>
<style>
  body { margin:0; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
         background:#fff; color:#191017; display:flex; min-height:100vh;
         align-items:center; justify-content:center; padding:24px; }
  .card { max-width:360px; text-align:center; }
  h1 { font-size:20px; margin:0 0 8px; }
  p { color:#7a6d76; font-size:14px; line-height:1.5; margin:0 0 16px; }
  a.btn { display:inline-block; background:#191017; color:#fff; text-decoration:none;
          border-radius:10px; padding:12px 20px; font-weight:700; }
  .code { margin-top:16px; color:#7a6d76; font-size:13px; }
  .code b { color:#191017; letter-spacing:4px; }
</style>
</head>
<body>
  <div class="card">
    <h1>在 Yummy or Not 中打开</h1>
    <p>正在为你打开 App 导入这条分享…如果没有自动跳转，请点击下面的按钮。</p>
    <a class="btn" id="open" href="${esc(deepLink)}">打开 App 导入</a>
    <p class="code">没有安装？打开 Yummy or Not，输入口令：<br /><b>${esc(code)}</b></p>
  </div>
  <script>
    // Best-effort hand-off to the native app. The deep link only resolves when
    // the app is installed; if it isn't, nothing happens and the manual button +
    // printed code remain. We don't redirect to an app store here because no
    // store listing URL is wired into the build yet.
    (function () {
      try { window.location.href = ${JSON.stringify(deepLink)}; } catch (e) {}
    })();
  </script>
</body>
</html>`;
}

export async function GET(req: NextRequest, { params }: RouteContext) {
  // Brute-force guard: the import code is only ~30 bits. Share the SAME per-IP
  // bucket as GET /api/share/resolve so an attacker can't sidestep that limit by
  // grinding /i/<code> instead. 10/min is generous for a human opening a link.
  const limited = await enforceRateLimits([
    { scope: 'share:resolve:ip', identifier: clientIp(req), limit: 10, windowMs: 60 * 1000 },
  ]);
  if (limited.limited) return rateLimitedResponse(null, limited.retryAfterSeconds);

  const { code: rawCode } = await params;
  const code = (rawCode ?? '').trim().toUpperCase();
  if (!code) return htmlResponse(gonePage(''), 404);

  try {
    const token = await resolveImportCode(code);
    if (!token) return htmlResponse(gonePage(code), 404);
    return htmlResponse(landingPage(code, token), 200);
  } catch (err) {
    console.error('GET /i/[code] error:', err);
    return htmlResponse(gonePage(code), 500);
  }
}
