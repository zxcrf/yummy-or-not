// POST /api/share/[token]/import — a logged-in user copies a shared taste into
// their own library as a status='todo', verdict=null row. The photo is COPIED
// into the importer's namespace at THIS point (copy-on-import), so the copy is
// decoupled from the source from here on (source edit/delete/revoke can't touch
// it). Idempotent via UNIQUE(from_token, importer_id).
//
// 201 — newly created copy (a Taste)
// 200 — idempotent repeat: the existing copy (UNIQUE hit)
// 401 — not signed in
// 410 { error: 'share_gone' } — revoked / expired / source deleted / unknown
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { withCors, corsPreflight } from '@/lib/cors';
import { getUserFromRequest } from '@/lib/auth';
import { getShareToken, importSharedTaste } from '@/lib/db';

type RouteContext = { params: Promise<{ token: string }> };

export async function OPTIONS(req: NextRequest) {
  return corsPreflight(req.headers.get('origin'));
}

function tokenGone(t: { revoked: boolean; expiresAt: string | null }): boolean {
  if (t.revoked) return true;
  if (t.expiresAt && new Date(t.expiresAt).getTime() <= Date.now()) return true;
  return false;
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  const origin = req.headers.get('origin');
  const user = await getUserFromRequest(req);
  if (!user) return withCors(NextResponse.json({ error: 'unauthorized' }, { status: 401 }), origin);
  const { token } = await params;

  try {
    // Gate on the pointer BEFORE any copy: revoked/expired/unknown → 410, and
    // importSharedTaste is never called (no copy performed).
    const ptr = await getShareToken(token);
    if (!ptr || tokenGone(ptr)) {
      return withCors(NextResponse.json({ error: 'share_gone' }, { status: 410 }), origin);
    }

    const result = await importSharedTaste({ token, importerId: user.id });
    if (!result) {
      // Source taste deleted between gate and copy → 410.
      return withCors(NextResponse.json({ error: 'share_gone' }, { status: 410 }), origin);
    }

    // 201 on first import; 200 on an idempotent repeat (the existing copy).
    return withCors(
      NextResponse.json(result.taste, { status: result.created ? 201 : 200 }),
      origin
    );
  } catch (err) {
    console.error(`POST /api/share/${token}/import error:`, err);
    return withCors(NextResponse.json({ error: 'Internal server error' }, { status: 500 }), origin);
  }
}
