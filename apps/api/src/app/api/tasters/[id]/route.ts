// PATCH  /api/tasters/[id] — rename / re-avatar a persona { displayName?, avatar? }. PRO ONLY.
// DELETE /api/tasters/[id] — remove a persona. PRO ONLY; the self-taster is undeletable.
//
// Pro gating is enforced SERVER-SIDE (never trust the client). The self-taster
// (is_self) is protected: even a pro account cannot delete its own default
// persona — it is the implicit attribution for un-tagged records.
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { getTaster, updateTaster, deleteTaster } from '@/lib/db';
import { withCors, corsPreflight } from '@/lib/cors';
import { getUserFromRequest } from '@/lib/auth';

const NAME_MAX_LEN = 50;

export async function OPTIONS(req: NextRequest) {
  return corsPreflight(req.headers.get('origin'));
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const origin = req.headers.get('origin');
  const user = await getUserFromRequest(req);
  if (!user) return withCors(NextResponse.json({ error: 'unauthorized' }, { status: 401 }), origin);

  // Server-side pro gate — editing personas is pro-only.
  if (user.plan !== 'pro') {
    return withCors(NextResponse.json({ error: 'pro_required' }, { status: 403 }), origin);
  }

  const { id } = await params;

  try {
    const body = await req.json().catch(() => ({}));
    const patch: { displayName?: string; avatar?: string } = {};

    if (typeof body?.displayName === 'string') {
      const name = body.displayName.trim();
      if (!name) {
        return withCors(NextResponse.json({ error: 'name_required' }, { status: 400 }), origin);
      }
      if (name.length > NAME_MAX_LEN) {
        return withCors(NextResponse.json({ error: 'name_too_long' }, { status: 400 }), origin);
      }
      patch.displayName = name;
    }
    if (typeof body?.avatar === 'string') {
      patch.avatar = body.avatar;
    }

    const updated = await updateTaster(user.id, id, patch);
    if (!updated) {
      return withCors(NextResponse.json({ error: 'not_found' }, { status: 404 }), origin);
    }
    return withCors(NextResponse.json(updated), origin);
  } catch (err) {
    console.error('PATCH /api/tasters/[id] error:', err);
    return withCors(NextResponse.json({ error: 'Internal server error' }, { status: 500 }), origin);
  }
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
    // Self-taster protection is absolute — it precedes even the pro gate, so the
    // owner's default persona can never be removed regardless of plan.
    const taster = await getTaster(user.id, id);
    if (taster?.isSelf) {
      return withCors(NextResponse.json({ error: 'self_taster_protected' }, { status: 409 }), origin);
    }

    // Server-side pro gate — only pro accounts manage multiple personas.
    if (user.plan !== 'pro') {
      return withCors(NextResponse.json({ error: 'pro_required' }, { status: 403 }), origin);
    }

    const deleted = await deleteTaster(user.id, id);
    if (!deleted) {
      return withCors(NextResponse.json({ error: 'not_found' }, { status: 404 }), origin);
    }
    return withCors(NextResponse.json({ ok: true }), origin);
  } catch (err) {
    console.error('DELETE /api/tasters/[id] error:', err);
    return withCors(NextResponse.json({ error: 'Internal server error' }, { status: 500 }), origin);
  }
}
