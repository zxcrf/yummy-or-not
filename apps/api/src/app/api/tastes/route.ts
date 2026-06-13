// GET /api/tastes  — list tastes (q, filter query params)
// POST /api/tastes — create a taste (JSON or multipart/form-data + optional photo)
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { listTastes, createTaste, countTastes, CreateTasteError } from '@/lib/db';
import { withCors, corsPreflight } from '@/lib/cors';
import { getUserFromRequest } from '@/lib/auth';
import { uploadPhoto, deletePhoto, assertMediaAllowed } from '@/lib/storage';
import { getPhotoStorage } from '@/lib/env';
import { origKey, variantKeys, makeVariants, safeExt } from '@/lib/image-variants';
import { FREE_TASTE_CAP, type CreateTasteInput, type Verdict, type TasteStatus } from '@yon/shared';

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
            // Transcode or a variant upload failed: fall back to the legacy
            // single-key path so the upload still succeeds (e.g. unsupported
            // format). All three uploads have settled by now, so deleting any
            // partial siblings cannot race a pending PUT.
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
