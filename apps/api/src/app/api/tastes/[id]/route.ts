// GET    /api/tastes/[id] — fetch one taste
// PATCH  /api/tastes/[id] — update taste (UpdateTasteInput)
// DELETE /api/tastes/[id] — delete taste
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { getTaste, updateTaste, deleteTaste, getRawImage } from '@/lib/db';
import { withCors, corsPreflight } from '@/lib/cors';
import { getUserFromRequest } from '@/lib/auth';
import { deletePhoto } from '@/lib/storage';
import { variantKeys, isVariantKey } from '@/lib/image-variants';
import type { UpdateTasteInput } from '@yon/shared';

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

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  const origin = req.headers.get('origin');
  const user = await getUserFromRequest(req);
  if (!user) return withCors(NextResponse.json({ error: 'unauthorized' }, { status: 401 }), origin);
  const { id } = await params;
  try {
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
    // Capture the stored key BEFORE deleting the row so we can clean up the object.
    const rawImage = await getRawImage(user.id, id);

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

    return withCors(NextResponse.json({ ok: true }), origin);
  } catch (err) {
    console.error(`DELETE /api/tastes/${id} error:`, err);
    return withCors(NextResponse.json({ error: 'Internal server error' }, { status: 500 }), origin);
  }
}
