// POST /api/tastes/[id]/purchases — record an additional purchase of a taste.
// Returns { purchase, boughtCount } where boughtCount is the new derived count.
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { addTastePurchase, getTaste } from '@/lib/db';
import { withCors, corsPreflight } from '@/lib/cors';
import { getUserFromRequest } from '@/lib/auth';

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
    const body = await req.json().catch(() => ({}));
    const price: string | null = typeof body?.price === 'string' ? body.price : null;
    const place: string | null = typeof body?.place === 'string' ? body.place : null;

    const purchase = await addTastePurchase(user.id, id, { price, place });
    if (!purchase) {
      return withCors(NextResponse.json({ error: 'not_found' }, { status: 404 }), origin);
    }

    // Return the updated taste so the client gets the new derived boughtCount in one round-trip.
    const taste = await getTaste(user.id, id);
    return withCors(
      NextResponse.json({ purchase, boughtCount: taste?.boughtCount ?? 1 }, { status: 201 }),
      origin
    );
  } catch (err) {
    console.error(`POST /api/tastes/${id}/purchases error:`, err);
    return withCors(NextResponse.json({ error: 'Internal server error' }, { status: 500 }), origin);
  }
}
