// POST   /api/tastes/[id]/share — mint a thin importable share token (owner-only).
// DELETE /api/tastes/[id]/share — revoke outstanding share tokens (owner-only).
//
// POST 200 { token, deepLink, importCode, expiresAt }
// POST 404 — taste not found / not owned (ownership via getTaste(user.id, id))
// DELETE 200 { ok: true } | 404 — nothing revoked (non-owner / already revoked)
//
// The minted token is the ONLY shareable artifact (embedded in the deep link
// and derived into the printed import code). We never forward the owner's raw
// presigned photo URL; preview presigns are minted on read behind a revoke/
// expiry gate (GET /api/share/:token). Mint writes ONE thin pointer row — no
// jsonb snapshot, no photo copy at mint time.
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { withCors, corsPreflight } from '@/lib/cors';
import { getUserFromRequest } from '@/lib/auth';
import { getTaste, createShareToken, revokeShareToken } from '@/lib/db';
import { shareDeepLink, importCodeFor } from '@/lib/share-token';

type RouteContext = { params: Promise<{ id: string }> };

export async function OPTIONS(req: NextRequest) {
  return corsPreflight(req.headers.get('origin'));
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  const origin = req.headers.get('origin');
  const user = await getUserFromRequest(req);
  if (!user) return withCors(NextResponse.json({ error: 'unauthorized' }, { status: 401 }), origin);
  const { id } = await params;

  try {
    // Ownership gate: getTaste is user-scoped, so a non-owned id resolves null.
    const source = await getTaste(user.id, id);
    if (!source) {
      // Not found OR not owned — same 404 (don't leak existence of others' rows).
      return withCors(NextResponse.json({ error: 'Not found' }, { status: 404 }), origin);
    }

    const row = await createShareToken({ tasteId: id, ownerId: user.id });
    return withCors(
      NextResponse.json({
        token: row.token,
        deepLink: shareDeepLink(row.token),
        importCode: importCodeFor(row.token),
        expiresAt: row.expiresAt,
      }),
      origin
    );
  } catch (err) {
    console.error(`POST /api/tastes/${id}/share error:`, err);
    return withCors(NextResponse.json({ error: 'Internal server error' }, { status: 500 }), origin);
  }
}

export async function DELETE(req: NextRequest, { params }: RouteContext) {
  const origin = req.headers.get('origin');
  const user = await getUserFromRequest(req);
  if (!user) return withCors(NextResponse.json({ error: 'unauthorized' }, { status: 401 }), origin);
  const { id } = await params;

  try {
    // Owner-scoped: a non-owner revokes nothing → false → 404.
    const revoked = await revokeShareToken({ ownerId: user.id, tasteId: id });
    if (!revoked) {
      return withCors(NextResponse.json({ error: 'Not found' }, { status: 404 }), origin);
    }
    return withCors(NextResponse.json({ ok: true }), origin);
  } catch (err) {
    console.error(`DELETE /api/tastes/${id}/share error:`, err);
    return withCors(NextResponse.json({ error: 'Internal server error' }, { status: 500 }), origin);
  }
}
