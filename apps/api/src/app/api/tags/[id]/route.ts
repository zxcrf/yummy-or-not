// DELETE /api/tags/[id] — remove a tag from the user's candidate set
// PATCH  /api/tags/[id] — rename a tag in the user's candidate set
// Neither operation touches tastes.tags (historical data is never rewritten).
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { deleteUserTag, renameUserTag } from '@/lib/db';
import { withCors, corsPreflight } from '@/lib/cors';
import { getUserFromRequest } from '@/lib/auth';

const NAME_MAX_LEN = 32;

export async function OPTIONS(req: NextRequest) {
  return corsPreflight(req.headers.get('origin'));
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const origin = req.headers.get('origin');
  const user = await getUserFromRequest(req);
  if (!user) return withCors(NextResponse.json({ error: 'unauthorized' }, { status: 401 }), origin);

  const { id } = await params;

  try {
    const deleted = await deleteUserTag(user.id, id);
    if (!deleted) {
      return withCors(NextResponse.json({ error: 'not_found' }, { status: 404 }), origin);
    }
    return withCors(NextResponse.json({ ok: true }), origin);
  } catch (err) {
    console.error('DELETE /api/tags/[id] error:', err);
    return withCors(NextResponse.json({ error: 'Internal server error' }, { status: 500 }), origin);
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const origin = req.headers.get('origin');
  const user = await getUserFromRequest(req);
  if (!user) return withCors(NextResponse.json({ error: 'unauthorized' }, { status: 401 }), origin);

  const { id } = await params;

  try {
    const body = await req.json().catch(() => ({}));
    const raw: string = typeof body?.name === 'string' ? body.name : '';
    const name = raw.trim();

    if (!name) {
      return withCors(NextResponse.json({ error: 'name_required' }, { status: 400 }), origin);
    }
    if (name.length > NAME_MAX_LEN) {
      return withCors(NextResponse.json({ error: 'name_too_long' }, { status: 400 }), origin);
    }

    const result = await renameUserTag(user.id, id, name);
    if (result === 'not_found') {
      return withCors(NextResponse.json({ error: 'not_found' }, { status: 404 }), origin);
    }
    if (result === 'name_conflict') {
      return withCors(NextResponse.json({ error: 'name_conflict' }, { status: 409 }), origin);
    }
    return withCors(NextResponse.json(result), origin);
  } catch (err) {
    console.error('PATCH /api/tags/[id] error:', err);
    return withCors(NextResponse.json({ error: 'Internal server error' }, { status: 500 }), origin);
  }
}
