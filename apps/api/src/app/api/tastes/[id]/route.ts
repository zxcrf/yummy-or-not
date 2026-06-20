// GET    /api/tastes/[id] — fetch one taste
// PATCH  /api/tastes/[id] — update taste (UpdateTasteInput)
// DELETE /api/tastes/[id] — delete taste
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { getTaste, updateTaste, deleteTaste, getRawImage, getRawClipKey } from '@/lib/db';
import { withCors, corsPreflight } from '@/lib/cors';
import { getUserFromRequest } from '@/lib/auth';
import { uploadPhoto, deletePhoto, assertMediaAllowed } from '@/lib/storage';
import { getPhotoStorage } from '@/lib/env';
import { origKey, variantKeys, makeVariants, safeExt, isVariantKey } from '@/lib/image-variants';
import type { UpdateTasteInput, Verdict } from '@yon/shared';

/** True when `image` is a bare storage key we own (not a legacy http/uploads URL). */
function isOwnedKey(image: string | null | undefined): image is string {
  if (!image) return false;
  return (
    !image.startsWith('http://') &&
    !image.startsWith('https://') &&
    !image.startsWith('/uploads/')
  );
}

type RouteContext = { params: Promise<{ id: string }> };

export async function OPTIONS(req: NextRequest) {
  return corsPreflight(req.headers.get('origin'));
}

export async function GET(req: NextRequest, { params }: RouteContext) {
  const origin = req.headers.get('origin');
  const user = await getUserFromRequest(req);
  if (!user) return withCors(NextResponse.json({ error: 'unauthorized' }, { status: 401 }), origin);
  const { id } = await params;
  try {
    const taste = await getTaste(user.id, id);
    if (!taste) return withCors(NextResponse.json({ error: 'Not found' }, { status: 404 }), origin);
    return withCors(NextResponse.json(taste), origin);
  } catch (err) {
    console.error(`GET /api/tastes/${id} error:`, err);
    return withCors(NextResponse.json({ error: 'Internal server error' }, { status: 500 }), origin);
  }
}

function parsePatchForm(form: FormData): UpdateTasteInput {
  const patch: UpdateTasteInput = {};
  const name = form.get('name');
  const place = form.get('place');
  const price = form.get('price');
  const verdict = form.get('verdict');
  const status = form.get('status');
  const notes = form.get('notes');
  const warnBeforeBuy = form.get('warnBeforeBuy');
  const lat = form.get('lat');
  const lng = form.get('lng');
  if (typeof name === 'string') patch.name = name;
  if (typeof place === 'string') patch.place = place;
  if (typeof price === 'string') patch.price = price;
  if (typeof verdict === 'string') patch.verdict = verdict as Verdict;
  if (status === 'tasted') patch.status = status;
  if (typeof notes === 'string') patch.notes = notes;
  if (typeof warnBeforeBuy === 'string') patch.warnBeforeBuy = warnBeforeBuy === 'true';
  // Coordinates ride along when the user edits the pin together with a new
  // photo. An empty string is the explicit "clear the pin" signal (→ null);
  // a numeric string sets it. updateTaste re-validates/clamps either way.
  if (typeof lat === 'string') patch.lat = lat === '' ? null : Number(lat);
  if (typeof lng === 'string') patch.lng = lng === '' ? null : Number(lng);
  const tags = form.getAll('tags').map(String);
  if (tags.length) patch.tags = tags;
  return patch;
}

async function validateDecodableImage(buffer: Buffer): Promise<boolean> {
  const ALLOWED_IMAGE_FORMATS = new Set([
    'jpeg', 'png', 'webp', 'gif', 'tiff', 'avif', 'heif', 'svg',
  ]);
  try {
    const { default: sharp } = await import('sharp');
    const meta = await sharp(buffer, { failOn: 'none' }).metadata();
    return ALLOWED_IMAGE_FORMATS.has(meta.format ?? '');
  } catch {
    return false;
  }
}

async function deleteImageObjects(image: string | null | undefined): Promise<void> {
  if (!isOwnedKey(image)) return;
  if (isVariantKey(image)) {
    const { orig, thumb, display } = variantKeys(image);
    await Promise.allSettled([deletePhoto(orig), deletePhoto(thumb), deletePhoto(display)]);
    return;
  }
  await deletePhoto(image).catch(() => {});
}

async function uploadTastePhoto(
  photo: File,
  origin: string | null,
  user: { mediaEnabled: boolean },
): Promise<
  | { error: NextResponse }
  | { ok: true; imageKey: string }
> {
  const blocked = assertMediaAllowed(user, photo.type || 'application/octet-stream', photo.name);
  if (blocked) {
    return { error: withCors(NextResponse.json({ error: blocked }, { status: 403 }), origin) };
  }
  if (photo.size > 25 * 1024 * 1024) {
    return { error: withCors(NextResponse.json({ error: 'photo_too_large' }, { status: 413 }), origin) };
  }

  const buffer = Buffer.from(await photo.arrayBuffer());
  const backend = getPhotoStorage();
  if (backend === 'blob') {
    const key = `${crypto.randomUUID()}.${safeExt(photo.name)}`;
    const imageKey = await uploadPhoto(buffer, { key, contentType: photo.type || 'application/octet-stream' });
    return { ok: true, imageKey };
  }

  const ok = origKey(crypto.randomUUID(), safeExt(photo.name));
  const { thumb: thumbKey, display: displayKey } = variantKeys(ok);
  try {
    const { thumb, display } = await makeVariants(buffer);
    const uploads = await Promise.allSettled([
      uploadPhoto(buffer,  { key: ok,         contentType: photo.type || 'application/octet-stream' }),
      uploadPhoto(thumb,   { key: thumbKey,   contentType: 'image/webp' }),
      uploadPhoto(display, { key: displayKey, contentType: 'image/webp' }),
    ]);
    const failed = uploads.find((r) => r.status === 'rejected');
    if (failed) throw (failed as PromiseRejectedResult).reason;
    return { ok: true, imageKey: ok };
  } catch (sharpErr) {
    const isDecodableImage = await validateDecodableImage(buffer);
    if (!isDecodableImage) {
      await Promise.allSettled([deletePhoto(ok), deletePhoto(thumbKey), deletePhoto(displayKey)]);
      return { error: withCors(NextResponse.json({ error: 'invalid_image' }, { status: 400 }), origin) };
    }

    console.error(`PATCH /api/tastes: variant generation failed, using legacy path:`, sharpErr);
    await Promise.allSettled([deletePhoto(ok), deletePhoto(thumbKey), deletePhoto(displayKey)]);
    const key = `${crypto.randomUUID()}.${safeExt(photo.name)}`;
    const imageKey = await uploadPhoto(buffer, { key, contentType: photo.type || 'application/octet-stream' });
    return { ok: true, imageKey };
  }
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  const origin = req.headers.get('origin');
  const user = await getUserFromRequest(req);
  if (!user) return withCors(NextResponse.json({ error: 'unauthorized' }, { status: 401 }), origin);
  const { id } = await params;
  try {
    const contentType = req.headers.get('content-type') ?? '';
    if (contentType.includes('multipart/form-data')) {
      const existing = await getTaste(user.id, id);
      if (!existing) return withCors(NextResponse.json({ error: 'Not found' }, { status: 404 }), origin);

      const form = await req.formData();
      const patch = parsePatchForm(form);
      const photo = form.get('photo') as File | null;
      let imageKey: string | undefined;
      if (photo && photo.size > 0) {
        const uploaded = await uploadTastePhoto(photo, origin, user);
        if ('error' in uploaded) return uploaded.error;
        imageKey = uploaded.imageKey;
      }

      const result = imageKey
        ? await updateTaste(user.id, id, patch, { imageKey })
        : await updateTaste(user.id, id, patch);
      if (result === 'invalid_status_transition' || result === 'verdict_required') {
        if (imageKey) await deleteImageObjects(imageKey);
        return withCors(NextResponse.json({ error: result }, { status: 400 }), origin);
      }
      if (!result) {
        if (imageKey) await deleteImageObjects(imageKey);
        return withCors(NextResponse.json({ error: 'Not found' }, { status: 404 }), origin);
      }
      if (typeof result === 'object' && 'previousImage' in result) {
        await deleteImageObjects(result.previousImage);
        return withCors(NextResponse.json(result.taste), origin);
      }
      return withCors(NextResponse.json(result), origin);
    }

    const patch = (await req.json()) as UpdateTasteInput;
    const result = await updateTaste(user.id, id, patch);
    if (result === 'invalid_status_transition' || result === 'verdict_required') {
      return withCors(NextResponse.json({ error: result }, { status: 400 }), origin);
    }
    if (!result) return withCors(NextResponse.json({ error: 'Not found' }, { status: 404 }), origin);
    return withCors(NextResponse.json(result), origin);
  } catch (err) {
    console.error(`PATCH /api/tastes/${id} error:`, err);
    return withCors(NextResponse.json({ error: 'Internal server error' }, { status: 500 }), origin);
  }
}

export async function DELETE(req: NextRequest, { params }: RouteContext) {
  const origin = req.headers.get('origin');
  const user = await getUserFromRequest(req);
  if (!user) return withCors(NextResponse.json({ error: 'unauthorized' }, { status: 401 }), origin);
  const { id } = await params;
  try {
    // Capture the stored keys BEFORE deleting the row so we can clean up the
    // objects. ⟦DR#4⟧ A video row also carries a private clip key (image is the
    // poster) — capture it too so DELETE cleans the clip, not just the poster.
    const rawImage = await getRawImage(user.id, id);
    const rawClipKey = await getRawClipKey(user.id, id);

    const deleted = await deleteTaste(user.id, id);
    if (!deleted) return withCors(NextResponse.json({ error: 'Not found' }, { status: 404 }), origin);

    // Best-effort object cleanup: the DB row is authoritative; never fail the
    // request over an orphaned object. Only delete keys we own (skip legacy
    // http/uploads images, which include the unsplash seed rows).
    if (isOwnedKey(rawImage)) {
      if (isVariantKey(rawImage)) {
        // Delete all three sibling keys (orig + thumb + display) in parallel.
        const { orig, thumb, display } = variantKeys(rawImage);
        const results = await Promise.allSettled([
          deletePhoto(orig),
          deletePhoto(thumb),
          deletePhoto(display),
        ]);
        results.forEach((r, i) => {
          if (r.status === 'rejected') {
            const key = [orig, thumb, display][i];
            console.error(`DELETE /api/tastes/${id}: cleanup failed for "${key}":`, r.reason);
          }
        });
      } else {
        try {
          await deletePhoto(rawImage);
        } catch (cleanupErr) {
          console.error(`DELETE /api/tastes/${id}: photo cleanup failed for "${rawImage}":`, cleanupErr);
        }
      }
    }

    // ⟦DR#4⟧ Best-effort clip cleanup. The clip is a single private object under
    // u/{uid}/clips/... (no variants), so a flat deletePhoto suffices. Never fail
    // the request over an orphaned clip — the DB row (authoritative) is gone.
    if (rawClipKey) {
      try {
        await deletePhoto(rawClipKey);
      } catch (cleanupErr) {
        console.error(`DELETE /api/tastes/${id}: clip cleanup failed for "${rawClipKey}":`, cleanupErr);
      }
    }

    return withCors(NextResponse.json({ ok: true }), origin);
  } catch (err) {
    console.error(`DELETE /api/tastes/${id} error:`, err);
    return withCors(NextResponse.json({ error: 'Internal server error' }, { status: 500 }), origin);
  }
}
