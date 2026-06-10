// GET  /api/tags  — list the signed-in user's tag candidate set (lazy-seeded)
// POST /api/tags  — create/upsert a tag { name }
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { listUserTags, createUserTag } from '@/lib/db';
import { withCors, corsPreflight } from '@/lib/cors';
import { getUserFromRequest } from '@/lib/auth';

const NAME_MAX_LEN = 32;

export async function OPTIONS(req: NextRequest) {
  return corsPreflight(req.headers.get('origin'));
}

export async function GET(req: NextRequest) {
  const origin = req.headers.get('origin');
  const user = await getUserFromRequest(req);
  if (!user) return withCors(NextResponse.json({ error: 'unauthorized' }, { status: 401 }), origin);

  try {
    const tags = await listUserTags(user.id);
    return withCors(NextResponse.json(tags), origin);
  } catch (err) {
    console.error('GET /api/tags error:', err);
    return withCors(NextResponse.json({ error: 'Internal server error' }, { status: 500 }), origin);
  }
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get('origin');
  const user = await getUserFromRequest(req);
  if (!user) return withCors(NextResponse.json({ error: 'unauthorized' }, { status: 401 }), origin);

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

    const tag = await createUserTag(user.id, name);
    return withCors(NextResponse.json(tag, { status: 201 }), origin);
  } catch (err) {
    console.error('POST /api/tags error:', err);
    return withCors(NextResponse.json({ error: 'Internal server error' }, { status: 500 }), origin);
  }
}
