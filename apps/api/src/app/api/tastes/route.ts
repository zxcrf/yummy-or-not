// GET /api/tastes  — list tastes (q, filter query params)
// POST /api/tastes — create a taste (JSON or multipart/form-data + optional photo)
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { listTastes, createTaste } from '@/lib/db';
import { withCors, corsPreflight } from '@/lib/cors';
import { getUserFromRequest } from '@/lib/auth';
import { uploadPhoto } from '@/lib/storage';
import type { CreateTasteInput, Verdict } from '@yon/shared';

export async function OPTIONS(req: NextRequest) {
  return corsPreflight(req.headers.get('origin'));
}

export async function GET(req: NextRequest) {
  const origin = req.headers.get('origin');
  const user = await getUserFromRequest(req);
  if (!user) return withCors(NextResponse.json({ error: 'unauthorized' }, { status: 401 }), origin);
  const { searchParams } = req.nextUrl;
  const q      = searchParams.get('q')      ?? undefined;
  const filter = searchParams.get('filter') ?? undefined;

  try {
    const tastes = await listTastes(user.id, { q, filter });
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
      const notes   = (form.get('notes')   as string | null) ?? '';
      const imageField = (form.get('image') as string | null) ?? '';

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
        verdict: verdict as Verdict,
        tags,
        notes,
        image: imageField,
      };

      // Handle optional photo upload
      const photo = form.get('photo') as File | null;
      if (photo && photo.size > 0) {
        const ext = photo.name.split('.').pop() ?? 'bin';
        const key = `${crypto.randomUUID()}.${ext}`;
        const buffer = Buffer.from(await photo.arrayBuffer());
        imageUrl = await uploadPhoto(buffer, { key, contentType: photo.type || 'application/octet-stream' });
      }

      const taste = await createTaste(user.id, input, imageUrl);
      return withCors(NextResponse.json(taste, { status: 201 }), origin);
    } else {
      // JSON body
      input = (await req.json()) as CreateTasteInput;
      const taste = await createTaste(user.id, input);
      return withCors(NextResponse.json(taste, { status: 201 }), origin);
    }
  } catch (err) {
    console.error('POST /api/tastes error:', err);
    return withCors(NextResponse.json({ error: 'Internal server error' }, { status: 500 }), origin);
  }
}
