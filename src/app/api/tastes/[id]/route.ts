// GET    /api/tastes/[id] — fetch one taste (must be owned by the caller)
// PATCH  /api/tastes/[id] — update taste (UpdateTasteInput)
// DELETE /api/tastes/[id] — delete taste
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { getTaste, updateTaste, deleteTaste } from '@/lib/db';
import { getUserFromRequest } from '@/lib/auth';
import type { UpdateTasteInput } from '@/lib/types';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: RouteContext) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  try {
    const taste = await getTaste(user.id, id);
    if (!taste) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(taste);
  } catch (err) {
    console.error(`GET /api/tastes/${id} error:`, err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  try {
    const patch = (await req.json()) as UpdateTasteInput;
    const taste = await updateTaste(user.id, id, patch);
    if (!taste) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(taste);
  } catch (err) {
    console.error(`PATCH /api/tastes/${id} error:`, err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: RouteContext) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  try {
    const deleted = await deleteTaste(user.id, id);
    if (!deleted) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`DELETE /api/tastes/${id} error:`, err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
