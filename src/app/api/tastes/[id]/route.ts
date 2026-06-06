// GET    /api/tastes/[id] — fetch one taste
// PATCH  /api/tastes/[id] — update taste (UpdateTasteInput)
// DELETE /api/tastes/[id] — delete taste
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { getTaste, updateTaste, deleteTaste } from '@/lib/db';
import type { UpdateTasteInput } from '@/lib/types';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  try {
    const taste = await getTaste(id);
    if (!taste) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(taste);
  } catch (err) {
    console.error(`GET /api/tastes/${id} error:`, err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  try {
    const patch = (await req.json()) as UpdateTasteInput;
    const taste = await updateTaste(id, patch);
    if (!taste) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(taste);
  } catch (err) {
    console.error(`PATCH /api/tastes/${id} error:`, err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  try {
    const deleted = await deleteTaste(id);
    if (!deleted) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`DELETE /api/tastes/${id} error:`, err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
