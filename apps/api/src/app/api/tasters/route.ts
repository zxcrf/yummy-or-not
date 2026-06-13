// GET  /api/tasters — list the signed-in account's taster personas (self + others).
// POST /api/tasters — create a persona { displayName, avatar? }. PRO ONLY.
//
// Pro gating is enforced SERVER-SIDE: a free account may only ever have its
// self-taster, so POST/PATCH/DELETE are rejected before any DB write. Never
// trust the client (§S3b 权限: 服务端在 POST/PATCH taster 处校验 plan).
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { listTasters, createTaster } from '@/lib/db';
import { withCors, corsPreflight } from '@/lib/cors';
import { getUserFromRequest } from '@/lib/auth';

const NAME_MAX_LEN = 50;

export async function OPTIONS(req: NextRequest) {
  return corsPreflight(req.headers.get('origin'));
}

export async function GET(req: NextRequest) {
  const origin = req.headers.get('origin');
  const user = await getUserFromRequest(req);
  if (!user) return withCors(NextResponse.json({ error: 'unauthorized' }, { status: 401 }), origin);

  try {
    const tasters = await listTasters(user.id);
    return withCors(NextResponse.json(tasters), origin);
  } catch (err) {
    console.error('GET /api/tasters error:', err);
    return withCors(NextResponse.json({ error: 'Internal server error' }, { status: 500 }), origin);
  }
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get('origin');
  const user = await getUserFromRequest(req);
  if (!user) return withCors(NextResponse.json({ error: 'unauthorized' }, { status: 401 }), origin);

  // Server-side pro gate — runs before any write so a free user can never mint
  // a second persona.
  if (user.plan !== 'pro') {
    return withCors(NextResponse.json({ error: 'pro_required' }, { status: 403 }), origin);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const raw: string = typeof body?.displayName === 'string' ? body.displayName : '';
    const displayName = raw.trim();
    const avatar: string = typeof body?.avatar === 'string' ? body.avatar : '';

    if (!displayName) {
      return withCors(NextResponse.json({ error: 'name_required' }, { status: 400 }), origin);
    }
    if (displayName.length > NAME_MAX_LEN) {
      return withCors(NextResponse.json({ error: 'name_too_long' }, { status: 400 }), origin);
    }

    const taster = await createTaster(user.id, { displayName, avatar });
    return withCors(NextResponse.json(taster, { status: 201 }), origin);
  } catch (err) {
    console.error('POST /api/tasters error:', err);
    return withCors(NextResponse.json({ error: 'Internal server error' }, { status: 500 }), origin);
  }
}
