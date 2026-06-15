// POST /api/uploads/presign — issue a short-lived presigned PUT URL for a
// direct-to-R2 upload (S3b-media Phase 1: user avatar only).
//
// The KEY is ALWAYS server-generated — the client never supplies it (IDOR guard,
// mirrors sanitizeClientImage). The signature binds Bucket + Key + Content-Type,
// so the client must replay the returned `headers` on the PUT or the signature
// fails. Only the s3/R2 backend is supported; local/blob dev returns 501.
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { withCors, corsPreflight } from '@/lib/cors';
import { getUserFromRequest } from '@/lib/auth';
import { getPhotoStorage } from '@/lib/env';
import { getPresignedUploadUrl } from '@/lib/storage';

// Image allowlist — the client always sends JPEG (compressAsset), this is the
// server backstop. Video is deliberately NOT allowed in Phase 1.
const CONTENT_TYPE_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export async function OPTIONS(req: NextRequest) {
  return corsPreflight(req.headers.get('origin'));
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get('origin');
  const user = await getUserFromRequest(req);
  if (!user) return withCors(NextResponse.json({ error: 'unauthorized' }, { status: 401 }), origin);

  // Phase 1 only targets the s3/R2 prod path. Local dev avatar still uses the
  // legacy typed value, so a presign request there is unsupported.
  if (getPhotoStorage() !== 's3') {
    return withCors(NextResponse.json({ error: 'presign_unsupported' }, { status: 501 }), origin);
  }

  try {
    const body = await req.json().catch(() => ({}));

    if (body?.kind !== 'avatar') {
      return withCors(NextResponse.json({ error: 'invalid_kind' }, { status: 400 }), origin);
    }

    const contentType: unknown = body?.contentType;
    // Use Object.hasOwn (not `in`) to avoid prototype-chain bypass: property
    // names like "toString" or "constructor" satisfy `in` on a plain object
    // but are not image content types — they would produce an undefined/empty
    // ext and mint a presigned PUT for an unsupported type.
    if (
      typeof contentType !== 'string' ||
      !Object.hasOwn(CONTENT_TYPE_EXT, contentType)
    ) {
      return withCors(
        NextResponse.json({ error: 'unsupported_content_type' }, { status: 400 }),
        origin
      );
    }

    const ext = CONTENT_TYPE_EXT[contentType];
    // Defence-in-depth: ext must be a non-empty string. This is always true for
    // the three entries defined above, but guards against a future misconfiguration
    // or the prototype-bypass path somehow slipping through.
    if (!ext) {
      return withCors(
        NextResponse.json({ error: 'unsupported_content_type' }, { status: 400 }),
        origin
      );
    }
    // Server-generated key under the caller's namespace — client value (if any)
    // is ignored entirely.
    const key = `u/${user.id}/avatar/${randomUUID()}.${ext}`;
    const uploadUrl = await getPresignedUploadUrl(key, contentType);

    return withCors(
      NextResponse.json({ uploadUrl, key, headers: { 'Content-Type': contentType } }),
      origin
    );
  } catch (err) {
    console.error('POST /api/uploads/presign error:', err);
    return withCors(NextResponse.json({ error: 'Internal server error' }, { status: 500 }), origin);
  }
}
