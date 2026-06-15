// GET /api/tastes  — list tastes (q, filter query params)
// POST /api/tastes — create a taste (JSON or multipart/form-data + optional photo)
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { listTastes, createTaste, countTastes, CreateTasteError } from '@/lib/db';
import { withCors, corsPreflight } from '@/lib/cors';
import { getUserFromRequest } from '@/lib/auth';
import { uploadPhoto, deletePhoto, assertMediaAllowed, headObject, CLIP_MAX_BYTES } from '@/lib/storage';
import { getPhotoStorage } from '@/lib/env';
import { origKey, variantKeys, makeVariants, safeExt } from '@/lib/image-variants';
import { FREE_TASTE_CAP, type CreateTasteInput, type Verdict, type TasteStatus } from '@yon/shared';

/** Max clip duration the server accepts (ms). The client caps the picker at 15s;
 *  a small tolerance absorbs container-vs-track rounding (a 15.0s clip can report
 *  ~15040ms). Anything beyond is a 400 clip_too_long. */
const CLIP_MAX_DURATION_MS = 15_000;
const CLIP_DURATION_TOLERANCE_MS = 500;

/** ⟦DR#1/DR#2⟧ Validate a video commit's media fields. Returns an error code the
 *  route maps to a status, or `{ clipKey, durationMs }` when valid. Pure: does NO
 *  network IO (the HEAD probe is done by the caller so a thrown error there is
 *  handled in one place). Enforces, in order:
 *   - clipKey is a string under THIS user's clips prefix (ownership — rejects a
 *     foreign u/{other}/clips/... key = IDOR) and matches .../clip.{mp4|mov}.
 *   - durationMs is a finite number ≤ the cap (+tolerance). */
function validateClipFields(
  userId: string,
  clipKey: unknown,
  durationMs: unknown
):
  | { error: 'invalid_clip_key' | 'clip_too_long' }
  | { ok: true; clipKey: string; durationMs: number } {
  if (typeof clipKey !== 'string') return { error: 'invalid_clip_key' };
  const prefix = `u/${userId}/clips/`;
  // Ownership prefix + shape. The presign route mints exactly
  // u/{user.id}/clips/{uuid}/clip.{mp4|mov}; pin that shape so a client can't
  // commit an arbitrary key (e.g. another user's object, or a non-clip path).
  const shape = new RegExp(`^u/${userId}/clips/[0-9a-fA-F-]+/clip\\.(mp4|mov)$`);
  if (!clipKey.startsWith(prefix) || !shape.test(clipKey)) {
    return { error: 'invalid_clip_key' };
  }
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs <= 0) {
    return { error: 'clip_too_long' };
  }
  if (durationMs > CLIP_MAX_DURATION_MS + CLIP_DURATION_TOLERANCE_MS) {
    return { error: 'clip_too_long' };
  }
  return { ok: true, clipKey, durationMs: Math.round(durationMs) };
}

/** Resolve + validate a `mediaType:'video'` commit. Shared by the multipart and
 *  JSON request paths so both enforce the SAME gate. Returns either a ready-to-send
 *  error response (status-tagged) or the validated `{ clipKey, durationMs }` to
 *  persist. ⟦GATE⟧ + ⟦DR#1/DR#2/DR#5⟧:
 *   - re-assert media_enabled (commit-side, not just presign) → 403.
 *   - clipKey ownership prefix + shape, duration cap → 400.
 *   - ⟦DR#5⟧ HEAD-verify the freshly-PUT object (NO body buffer — clips are 20MB):
 *       missing → 400 clip_not_uploaded; type not video/* → 400 unsupported_content_type;
 *       size > CLIP_MAX_BYTES → 413 clip_too_large. Best-effort delete on any HEAD
 *       failure so a rejected upload doesn't linger. */
async function resolveVideoCommit(
  user: { id: string; mediaEnabled: boolean },
  clipKey: unknown,
  durationMs: unknown,
  origin: string | null
): Promise<{ error: NextResponse } | { ok: true; clipKey: string; durationMs: number }> {
  const fail = (code: string, status: number) => ({
    error: withCors(NextResponse.json({ error: code }, { status }), origin),
  });

  // ⟦GATE⟧ commit-side Pro gate — never rely on the presign gate alone.
  if (!user.mediaEnabled) return fail('media_not_enabled', 403);

  const validated = validateClipFields(user.id, clipKey, durationMs);
  if ('error' in validated) {
    return fail(validated.error, 400);
  }

  // ⟦DR#5⟧ HEAD (not getObjectBuffer): prove the object exists + declared type/size
  // without pulling 20MB into the API heap.
  const head = await headObject(validated.clipKey);
  if (!head) {
    return fail('clip_not_uploaded', 400);
  }
  if (!(head.contentType ?? '').toLowerCase().startsWith('video/')) {
    await deletePhoto(validated.clipKey).catch(() => {});
    return fail('unsupported_content_type', 400);
  }
  if (head.contentLength !== undefined && head.contentLength > CLIP_MAX_BYTES) {
    await deletePhoto(validated.clipKey).catch(() => {});
    return fail('clip_too_large', 413);
  }

  return { ok: true, clipKey: validated.clipKey, durationMs: validated.durationMs };
}

export async function OPTIONS(req: NextRequest) {
  return corsPreflight(req.headers.get('origin'));
}

/** Only the server may assign bare storage keys. A client-supplied `image` is
 *  accepted only when it is empty or a legacy absolute URL (http(s):// or
 *  /uploads/…). Bare keys are dropped — otherwise a caller could store another
 *  user's object key and later mint a presigned original via /original (IDOR). */
function sanitizeClientImage(image: string | undefined | null): string {
  const v = (image ?? '').trim();
  if (!v) return '';
  if (v.startsWith('http://') || v.startsWith('https://') || v.startsWith('/uploads/')) {
    return v;
  }
  return '';
}

function parseOptionalFloat(value: FormDataEntryValue | null): number | undefined {
  if (typeof value !== 'string') return undefined;
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** A `tasted` row (the default) requires a verdict. A `todo` row may omit it.
 *  Returns true when the input is valid to create. Previously the DB NOT NULL
 *  on verdict was the only guard (a 500); migration 0006 removes it, so the
 *  app must enforce this explicitly. */
function tastedRequiresVerdict(input: CreateTasteInput): boolean {
  if (input.status === 'todo') return true;
  return Boolean(input.verdict);
}

export async function GET(req: NextRequest) {
  const origin = req.headers.get('origin');
  const user = await getUserFromRequest(req);
  if (!user) return withCors(NextResponse.json({ error: 'unauthorized' }, { status: 401 }), origin);
  const { searchParams } = req.nextUrl;
  const q      = searchParams.get('q')      ?? undefined;
  const filter = searchParams.get('filter') ?? undefined;
  // Lifecycle filter: default 'tasted' so old APKs (no param) never receive
  // todo rows (and thus never a verdict:null). Unknown values fall back to default.
  const statusParam = searchParams.get('status');
  const status: 'tasted' | 'todo' | 'all' =
    statusParam === 'todo' || statusParam === 'all' ? statusParam : 'tasted';
  // S3b: optional taster filter — restrict the list to one persona's records.
  const taster = searchParams.get('taster') ?? undefined;

  try {
    const tastes = await listTastes(user.id, { q, filter, status, taster });
    return withCors(NextResponse.json(tastes), origin);
  } catch (err) {
    console.error('GET /api/tastes error:', err);
    return withCors(NextResponse.json({ error: 'Internal server error' }, { status: 500 }), origin);
  }
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get('origin');
  const user = await getUserFromRequest(req);
  if (!user) return withCors(NextResponse.json({ error: 'unauthorized' }, { status: 401 }), origin);

  // Free-tier record cap (issue #2). Pro is unlimited. Checked before parsing the
  // body so we never upload a photo we're about to reject.
  if (user.plan !== 'pro') {
    const count = await countTastes(user.id);
    if (count >= FREE_TASTE_CAP) {
      return withCors(NextResponse.json({ error: 'taste_limit_reached' }, { status: 403 }), origin);
    }
  }

  try {
    const contentType = req.headers.get('content-type') ?? '';

    let input: CreateTasteInput;
    let imageUrl: string | undefined;

    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData();

      // Parse scalar fields
      const name    = (form.get('name')    as string | null) ?? '';
      const place   = (form.get('place')   as string | null) ?? '';
      const price   = (form.get('price')   as string | null) ?? '';
      const verdict = (form.get('verdict') as string | null) ?? '';
      const statusField = (form.get('status') as string | null) ?? '';
      const status: TasteStatus = statusField === 'todo' ? 'todo' : 'tasted';
      const notes   = (form.get('notes')   as string | null) ?? '';
      const imageField = (form.get('image') as string | null) ?? '';
      const lat = parseOptionalFloat(form.get('lat'));
      const lng = parseOptionalFloat(form.get('lng'));
      const tasterField = (form.get('tasterId') as string | null)?.trim() || undefined;

      // S3b Phase 2 media fields. The POSTER arrives as the `photo` file (existing
      // variant pipeline → `image` col, UNCHANGED). These describe the optional clip.
      const mediaTypeField = (form.get('mediaType') as string | null) ?? '';
      const clipKeyField = (form.get('clipKey') as string | null) ?? '';
      const durationField = form.get('durationMs');
      const durationParsed =
        typeof durationField === 'string' && durationField.trim() !== ''
          ? Number(durationField)
          : undefined;

      // Read all 'tags' values (one per fd.append call from the client).
      // Also handle legacy backward-compat where a single JSON-array string was sent.
      const tagsRaw = form.getAll('tags').map(String);
      const tags: string[] = tagsRaw.flatMap((t) => {
        const trimmed = t.trim();
        if (trimmed.startsWith('[')) {
          try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed)) return parsed.map(String).map((s) => s.trim()).filter(Boolean);
          } catch {
            // fall through
          }
        }
        return trimmed ? [trimmed] : [];
      });

      input = {
        name,
        place,
        price,
        status,
        verdict: verdict ? (verdict as Verdict) : undefined,
        tags,
        notes,
        image: sanitizeClientImage(imageField),
        ...(lat !== undefined ? { lat } : {}),
        ...(lng !== undefined ? { lng } : {}),
        ...(tasterField ? { tasterId: tasterField } : {}),
      };

      // Handle optional photo upload
      const photo = form.get('photo') as File | null;
      if (photo && photo.size > 0) {
        // S3b-media gate: reject a video / live-photo upload unless the account
        // has the media capability. Still images always pass. Server-side only.
        const blocked = assertMediaAllowed(user, photo.type || 'application/octet-stream', photo.name);
        if (blocked) {
          return withCors(NextResponse.json({ error: blocked }, { status: 403 }), origin);
        }
        if (photo.size > 25 * 1024 * 1024) {
          return withCors(NextResponse.json({ error: 'photo_too_large' }, { status: 413 }), origin);
        }
        const buffer = Buffer.from(await photo.arrayBuffer());
        const backend = getPhotoStorage();

        if (backend !== 'blob') {
          // Transcode into variants: orig + thumb + display.
          const ok = origKey(crypto.randomUUID(), safeExt(photo.name));
          const { thumb: thumbKey, display: displayKey } = variantKeys(ok);
          try {
            const { thumb, display } = await makeVariants(buffer);

            // allSettled (not Promise.all) so every upload finishes before we
            // decide. Promise.all rejects on the first failure while siblings
            // are still in flight — a delayed PUT could then complete AFTER the
            // cleanup delete and orphan the object. Waiting for all to settle
            // means cleanup never races an in-flight upload.
            const uploads = await Promise.allSettled([
              uploadPhoto(buffer,  { key: ok,         contentType: photo.type || 'application/octet-stream' }),
              uploadPhoto(thumb,   { key: thumbKey,   contentType: 'image/webp' }),
              uploadPhoto(display, { key: displayKey, contentType: 'image/webp' }),
            ]);
            const failed = uploads.find((r) => r.status === 'rejected');
            if (failed) throw (failed as PromiseRejectedResult).reason;

            // Store the orig key in the DB image column; resolvePhotoUrls reads it.
            imageUrl = ok;
          } catch (sharpErr) {
            // Transcode or a variant upload failed. Before falling back to the
            // legacy single-key path, confirm the buffer is actually a decodable
            // image. Without this check, a renamed video (e.g. video.mp4 →
            // photo.jpg sent as image/jpeg) passes the content-type gate above
            // (image/ prefix → assertMediaAllowed passes), makeVariants throws on
            // the video bytes, and the raw fallback would persist arbitrary
            // non-image bytes — bypassing the media gate entirely.
            //
            // sharp().metadata() does NOT transcode — it reads the header only.
            // Known-decodable image formats: jpeg/png/webp/gif/tiff/avif/heif/svg.
            // If metadata throws, the bytes are not a recognisable image format.
            const ALLOWED_IMAGE_FORMATS = new Set([
              'jpeg', 'png', 'webp', 'gif', 'tiff', 'avif', 'heif', 'svg',
            ]);
            let isDecodableImage = false;
            try {
              const { default: sharp } = await import('sharp');
              const meta = await sharp(buffer, { failOn: 'none' }).metadata();
              isDecodableImage = ALLOWED_IMAGE_FORMATS.has(meta.format ?? '');
            } catch {
              // metadata() itself threw — definitely not a recognised image.
              isDecodableImage = false;
            }

            if (!isDecodableImage) {
              // Bytes are not a decodable image. Clean up any partial uploads and
              // reject — do NOT store arbitrary bytes under an image key.
              console.error('POST /api/tastes: non-image bytes rejected in fallback path');
              await Promise.allSettled([deletePhoto(ok), deletePhoto(thumbKey), deletePhoto(displayKey)]);
              return withCors(NextResponse.json({ error: 'invalid_image' }, { status: 400 }), origin);
            }

            // Buffer is a valid image that sharp couldn't TRANSCODE (e.g. unusual
            // sub-format). Fall back to the legacy single-key upload.
            console.error('POST /api/tastes: variant generation failed, using legacy path:', sharpErr);
            await Promise.allSettled([deletePhoto(ok), deletePhoto(thumbKey), deletePhoto(displayKey)]);
            const key = `${crypto.randomUUID()}.${safeExt(photo.name)}`;
            imageUrl = await uploadPhoto(buffer, { key, contentType: photo.type || 'application/octet-stream' });
          }
        } else {
          // Blob backend: no variant support; keep legacy single-upload path.
          const key = `${crypto.randomUUID()}.${safeExt(photo.name)}`;
          imageUrl = await uploadPhoto(buffer, { key, contentType: photo.type || 'application/octet-stream' });
        }
      }

      if (!tastedRequiresVerdict(input)) {
        return withCors(NextResponse.json({ error: 'verdict_required' }, { status: 400 }), origin);
      }

      // S3b Phase 2: video commit. The `photo` above is the POSTER (image col);
      // the clip is the separately-uploaded private object referenced by clipKey.
      if (mediaTypeField === 'video') {
        const v = await resolveVideoCommit(user, clipKeyField, durationParsed, origin);
        if ('error' in v) return v.error;
        input.mediaType = 'video';
        input.clipKey = v.clipKey;
        input.durationMs = v.durationMs;
      } else if (clipKeyField || durationParsed !== undefined) {
        // ⟦DR#2⟧ clip fields on a non-video create are rejected early (the DB CHECK
        // is the backstop). A poster-only image must never carry a clip.
        return withCors(NextResponse.json({ error: 'invalid_media' }, { status: 400 }), origin);
      }

      const taste = await createTaste(user.id, input, imageUrl);
      return withCors(NextResponse.json(taste, { status: 201 }), origin);
    } else {
      // JSON body
      input = (await req.json()) as CreateTasteInput;
      input.image = sanitizeClientImage(input.image);
      // S3b: only forward a non-empty taster id; the DB layer applies the
      // self-taster default when none is given (never invent one here).
      const taster = typeof input.tasterId === 'string' ? input.tasterId.trim() : '';
      input.tasterId = taster || undefined;
      if (!tastedRequiresVerdict(input)) {
        return withCors(NextResponse.json({ error: 'verdict_required' }, { status: 400 }), origin);
      }

      // S3b Phase 2: a JSON create may also attach a clip (poster-via-photo is the
      // common case, but the same gate must hold here). ⟦DR#2⟧ reject clip fields on
      // a non-video create.
      if (input.mediaType === 'video') {
        const v = await resolveVideoCommit(user, input.clipKey, input.durationMs, origin);
        if ('error' in v) return v.error;
        input.mediaType = 'video';
        input.clipKey = v.clipKey;
        input.durationMs = v.durationMs;
      } else if (input.clipKey || input.durationMs !== undefined) {
        return withCors(NextResponse.json({ error: 'invalid_media' }, { status: 400 }), origin);
      }

      const taste = await createTaste(user.id, input);
      return withCors(NextResponse.json(taste, { status: 201 }), origin);
    }
  } catch (err) {
    // IDOR guard: a client-supplied tasterId not owned by this account is a bad
    // request, not a server error — surface 400 'invalid_taster'. Applies to both
    // the JSON and multipart paths (both call createTaste inside this try).
    if (err instanceof CreateTasteError) {
      return withCors(NextResponse.json({ error: err.code }, { status: 400 }), origin);
    }
    console.error('POST /api/tastes error:', err);
    return withCors(NextResponse.json({ error: 'Internal server error' }, { status: 500 }), origin);
  }
}
