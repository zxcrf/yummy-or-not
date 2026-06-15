// PATCH /api/user — update the signed-in user's settings.
export const runtime = 'nodejs';

import sharp from 'sharp';
import { NextRequest, NextResponse } from 'next/server';
import { updateUserSettings, getRawAvatar, isLegacyPhotoValue } from '@/lib/db';
import { withCors, corsPreflight } from '@/lib/cors';
import { getUserFromRequest } from '@/lib/auth';
import { getObjectBuffer, deletePhoto, AVATAR_MAX_BYTES, OversizeError } from '@/lib/storage';

// Image formats sharp must decode to for a committed avatar — the real anti-spoof
// gate. A non-image / video byte stream fails sharp decode regardless of the
// Content-Type header the client signed at presign time.
const AVATAR_ALLOWED_FORMATS = new Set(['jpeg', 'png', 'webp']);

export async function OPTIONS(req: NextRequest) {
  return corsPreflight(req.headers.get('origin'));
}

export async function PATCH(req: NextRequest) {
  const origin = req.headers.get('origin');
  const user = await getUserFromRequest(req);
  if (!user) return withCors(NextResponse.json({ error: 'unauthorized' }, { status: 401 }), origin);

  try {
    const body = await req.json().catch(() => ({}));
    const hasWarnings = Object.prototype.hasOwnProperty.call(body ?? {}, 'warningsEnabled');
    const hasLocation = Object.prototype.hasOwnProperty.call(body ?? {}, 'locationEnabled');
    const hasDisplayName = Object.prototype.hasOwnProperty.call(body ?? {}, 'displayName');
    const hasVisibility = Object.prototype.hasOwnProperty.call(body ?? {}, 'defaultVisibility');
    const hasAvatar = Object.prototype.hasOwnProperty.call(body ?? {}, 'avatar');

    if (hasWarnings && typeof body?.warningsEnabled !== 'boolean') {
      return withCors(
        NextResponse.json({ error: 'warningsEnabled must be a boolean' }, { status: 400 }),
        origin
      );
    }
    if (hasLocation && typeof body?.locationEnabled !== 'boolean') {
      return withCors(
        NextResponse.json({ error: 'locationEnabled must be a boolean' }, { status: 400 }),
        origin
      );
    }
    if (hasDisplayName) {
      const raw = body?.displayName;
      if (typeof raw !== 'string') {
        return withCors(
          NextResponse.json({ error: 'invalid_display_name' }, { status: 400 }),
          origin
        );
      }
      const trimmed = raw.trim();
      if (trimmed.length < 1 || trimmed.length > 50) {
        return withCors(
          NextResponse.json({ error: 'invalid_display_name' }, { status: 400 }),
          origin
        );
      }
    }
    if (hasVisibility && body?.defaultVisibility !== 'private' && body?.defaultVisibility !== 'shared') {
      return withCors(
        NextResponse.json({ error: 'invalid_default_visibility' }, { status: 400 }),
        origin
      );
    }

    // ── Avatar commit (S3b-media Phase 1) ────────────────────────────────────
    // `avatarToPersist` is the value to SET on users.avatar once validated. A
    // bare key is byte-verified against the freshly-PUT object before we trust it.
    let avatarToPersist: string | undefined;
    if (hasAvatar) {
      const raw: unknown = body?.avatar;
      if (typeof raw !== 'string') {
        return withCors(NextResponse.json({ error: 'invalid_avatar' }, { status: 400 }), origin);
      }
      if (raw === '') {
        // Clears the avatar.
        avatarToPersist = '';
      } else if (isLegacyPhotoValue(raw)) {
        // Legacy passthrough (OAuth avatars, /uploads/) — accept as-is, no probe.
        avatarToPersist = raw;
      } else {
        // Bare R2 key: must be a freshly-PUT object owned by THIS user.
        const ownPrefix = `u/${user.id}/avatar/`;
        if (!raw.startsWith(ownPrefix)) {
          return withCors(NextResponse.json({ error: 'invalid_avatar' }, { status: 400 }), origin);
        }

        // ⟦DR#1⟧ BYTE-verify: GET the object (bounded read) and decode with
        // sharp. The signed Content-Type header is NOT trusted — only the
        // decoded bytes prove format. OversizeError is thrown by getObjectBuffer
        // when the stream exceeds AVATAR_MAX_BYTES, so the full object is never
        // buffered for an oversize PUT (DoS guard).
        let buffer: Buffer;
        try {
          const result = await getObjectBuffer(raw, AVATAR_MAX_BYTES);
          if (!result) {
            return withCors(
              NextResponse.json({ error: 'avatar_not_uploaded' }, { status: 400 }),
              origin
            );
          }
          buffer = result;
        } catch (sizeErr) {
          if (sizeErr instanceof OversizeError) {
            // ⟦DR#2⟧ Best-effort delete the rejected bytes.
            await deletePhoto(raw).catch(() => {});
            return withCors(
              NextResponse.json({ error: 'avatar_too_large' }, { status: 413 }),
              origin
            );
          }
          throw sizeErr;
        }
        // ⟦DR#2⟧ On format-validation failure below, best-effort delete the
        // rejected bytes so we don't leave an orphan under u/{uid}/avatar/.
        let format: string | undefined;
        try {
          format = (await sharp(buffer).metadata()).format;
        } catch {
          format = undefined;
        }
        if (!format || !AVATAR_ALLOWED_FORMATS.has(format)) {
          await deletePhoto(raw).catch(() => {});
          return withCors(
            NextResponse.json({ error: 'unsupported_content_type' }, { status: 400 }),
            origin
          );
        }
        avatarToPersist = raw;
      }
    }

    if (!hasWarnings && !hasLocation && !hasDisplayName && !hasVisibility && !hasAvatar) {
      return withCors(
        NextResponse.json({ error: 'warningsEnabled or locationEnabled must be a boolean' }, { status: 400 }),
        origin
      );
    }

    // ⟦DR#2⟧ Capture the PRIOR (raw, un-presigned) avatar so we can best-effort
    // delete it after a successful replace. getRawAvatar returns the stored value
    // verbatim — findUserById would presign a bare key, hiding the real object key.
    const priorAvatar =
      avatarToPersist !== undefined ? await getRawAvatar(user.id) : null;

    const updated = await updateUserSettings(user.id, {
      ...(hasWarnings ? { warningsEnabled: body.warningsEnabled } : {}),
      ...(hasLocation ? { locationEnabled: body.locationEnabled } : {}),
      ...(hasDisplayName ? { displayName: (body.displayName as string).trim() } : {}),
      ...(hasVisibility ? { defaultVisibility: body.defaultVisibility as 'private' | 'shared' } : {}),
      ...(avatarToPersist !== undefined ? { avatar: avatarToPersist } : {}),
    });
    if (!updated) {
      return withCors(NextResponse.json({ error: 'not_found' }, { status: 404 }), origin);
    }

    // ⟦DR#2⟧ After the row updates, best-effort delete the prior bare-key avatar
    // (replace = no orphan). Never let a delete failure fail the request.
    if (
      priorAvatar &&
      avatarToPersist !== undefined &&
      priorAvatar !== avatarToPersist &&
      !isLegacyPhotoValue(priorAvatar)
    ) {
      await deletePhoto(priorAvatar).catch(() => {});
    }

    return withCors(NextResponse.json({ user: updated }), origin);
  } catch (err) {
    console.error('PATCH /api/user error:', err);
    return withCors(NextResponse.json({ error: 'Internal server error' }, { status: 500 }), origin);
  }
}
