// GET /api/tastes  — list tastes (q, filter query params)
// POST /api/tastes — create a taste (JSON or multipart/form-data + optional photo)
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { writeFile } from 'fs/promises';
import path from 'path';
import { listTastes, createTaste } from '@/lib/db';
import { getUserFromRequest } from '@/lib/auth';
import type { CreateTasteInput, Verdict } from '@/lib/types';

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const q      = searchParams.get('q')      ?? undefined;
  const filter = searchParams.get('filter') ?? undefined;

  try {
    const tastes = await listTastes(user.id, { q, filter });
    return NextResponse.json(tastes);
  } catch (err) {
    console.error('GET /api/tastes error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

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
        // Generate a temp id for the filename; createTaste will give us the real DB id.
        // We create a placeholder id here and use it both for the filename and pass
        // imageUrl so createTaste stores it. The DB id will differ — we rename after insert.
        const ext = photo.name.split('.').pop() ?? 'bin';
        const tmpId = `tmp_${Date.now()}`;
        const filename = `${tmpId}.${ext}`;
        const uploadsDir = path.join(process.cwd(), 'public', 'uploads');
        const filePath = path.join(uploadsDir, filename);

        const buffer = Buffer.from(await photo.arrayBuffer());
        await writeFile(filePath, buffer);

        // Store a temp path; we'll rename below once we have the real id.
        imageUrl = `/uploads/${filename}`;
      }

      const taste = await createTaste(user.id, input, imageUrl);

      // If we uploaded a photo under a tmp name, rename to the real taste id.
      if (imageUrl && imageUrl.includes('tmp_')) {
        const ext = imageUrl.split('.').pop() ?? 'bin';
        const oldPath = path.join(process.cwd(), 'public', imageUrl);
        const newFilename = `${taste.id}.${ext}`;
        const newPath = path.join(process.cwd(), 'public', 'uploads', newFilename);
        const { rename } = await import('fs/promises');
        await rename(oldPath, newPath);
        // Update the record with the correct image path
        const { updateTaste } = await import('@/lib/db');
        const updated = await updateTaste(user.id, taste.id, { image: `/uploads/${newFilename}` });
        return NextResponse.json(updated ?? taste, { status: 201 });
      }

      return NextResponse.json(taste, { status: 201 });
    } else {
      // JSON body
      input = (await req.json()) as CreateTasteInput;
      const taste = await createTaste(user.id, input);
      return NextResponse.json(taste, { status: 201 });
    }
  } catch (err) {
    console.error('POST /api/tastes error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
