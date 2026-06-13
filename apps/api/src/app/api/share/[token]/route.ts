// GET /api/share/[token] — public preview of a shared taste.
//
// Validates the token (not revoked, not expired, source still exists) → LIVE
// reads the source taste → mints a SHORT (<=60s) token-gated presign of the
// ORIGINAL R2 object. Returns the descriptive preview fields + photoUrl.
//
// 200 { name, place, price, verdict, tags, notes, photoUrl }
// 410 { error: 'share_gone' } — revoked / expired / source deleted / unknown
//
// SECURITY: we NEVER forward the owner's raw/long-lived presigned URL. Each read
// mints a FRESH <=60s presign behind the revoke/expiry gate, so revocation takes
// effect immediately (the DB flag stops any further presign from being issued).
// Unknown tokens also return 410 (not 404) so the endpoint is not an enumeration
// oracle. No auth required to PREVIEW (the unguessable token is the capability);
// import requires a logged-in user.
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { withCors, corsPreflight } from '@/lib/cors';
import { getShareToken, getTaste, getRawImage } from '@/lib/db';
import { getSignedPhotoUrl } from '@/lib/storage';
import { isVariantKey, variantKeys } from '@/lib/image-variants';

type RouteContext = { params: Promise<{ token: string }> };

// Short-lived presign for shared previews: <=60s so a leaked preview URL dies
// fast and revocation is effectively immediate (next read mints nothing).
export const SHARE_PRESIGN_TTL_SECONDS = 60;

export async function OPTIONS(req: NextRequest) {
  return corsPreflight(req.headers.get('origin'));
}

/** True when the token is gone for sharing purposes (revoked or expired). */
function tokenGone(t: { revoked: boolean; expiresAt: string | null }): boolean {
  if (t.revoked) return true;
  if (t.expiresAt && new Date(t.expiresAt).getTime() <= Date.now()) return true;
  return false;
}

/** Mint a short-lived presign for the source ORIGINAL object, or '' when there
 *  is no bare managed key to sign.
 *
 *  SECURITY: we ONLY mint a fresh <=60s presign for a BARE storage key. Any
 *  absolute-URL form (http:// or https://, including a legacy long-lived R2
 *  presigned URL stored in the image column) is returned as '' — never
 *  forwarded verbatim. Forwarding such a URL would hand the recipient a link
 *  valid for up to PRESIGN_TTL_SECONDS (1h default), surviving revocation and
 *  violating the route's "NEVER forward the owner's raw presigned URL"
 *  invariant. A photoless preview is the safe degraded behavior. /uploads/
 *  paths are local-backend public files, also not minted here → ''. */
async function presignOriginal(rawImage: string | null): Promise<string> {
  if (!rawImage) return '';
  if (
    rawImage.startsWith('http://') ||
    rawImage.startsWith('https://') ||
    rawImage.startsWith('/uploads/')
  ) {
    return '';
  }
  const key = isVariantKey(rawImage) ? variantKeys(rawImage).orig : rawImage.replace(/^\//, '');
  return getSignedPhotoUrl(key, SHARE_PRESIGN_TTL_SECONDS);
}

export async function GET(req: NextRequest, { params }: RouteContext) {
  const origin = req.headers.get('origin');
  const { token } = await params;

  try {
    const ptr = await getShareToken(token);
    // Unknown / revoked / expired → 410 BEFORE minting any presign.
    if (!ptr || tokenGone(ptr)) {
      return withCors(NextResponse.json({ error: 'share_gone' }, { status: 410 }), origin);
    }

    // LIVE read of the source (no jsonb snapshot). Source deleted → 410.
    const source = await getTaste(ptr.ownerId, ptr.tasteId);
    if (!source) {
      return withCors(NextResponse.json({ error: 'share_gone' }, { status: 410 }), origin);
    }

    const rawImage = await getRawImage(ptr.ownerId, ptr.tasteId);
    const photoUrl = await presignOriginal(rawImage);

    return withCors(
      NextResponse.json({
        name: source.name,
        place: source.place ?? '',
        price: source.price ?? '',
        verdict: source.verdict ?? null,
        tags: source.tags ?? [],
        notes: source.notes ?? '',
        photoUrl,
      }),
      origin
    );
  } catch (err) {
    console.error(`GET /api/share/${token} error:`, err);
    return withCors(NextResponse.json({ error: 'Internal server error' }, { status: 500 }), origin);
  }
}
