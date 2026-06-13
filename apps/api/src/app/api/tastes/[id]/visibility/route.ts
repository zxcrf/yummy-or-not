// PATCH /api/tastes/[id]/visibility — S3c targeted publish.
//
// Body: { targets: [{ type: 'geo'|'family'|'member', target_id? }] }.
// Server-side enforcement (never trust the client):
//   - AUTH: anonymous → 401 before any DB read.
//   - OWNERSHIP (IDOR): getTaste is scoped to the caller; a foreign taste reads
//     back null → 404 (don't leak existence), nothing written.
//   - geo publish requires coords → a geo target on a taste with no lat/lng is
//     rejected 422 (can't publish "nearby" what has no location; never write a
//     null geog). The route computes the precision-5 grid_cell here and hands the
//     DOUBLE-WRITE (grid_cell + lat/lng) to setTasteVisibility.
//   - PRO GATE: family/member targets require plan='pro' (pro≡family). A free
//     user → 403 pro_required, nothing written. geo is NOT pro-gated.
// On success setTasteVisibility writes taste_shares + flips tastes.visibility to
// 'shared' and the updated taste is returned.
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { getTaste, setTasteVisibility, findUnownedShareTargets } from '@/lib/db';
import { withCors, corsPreflight } from '@/lib/cors';
import { getUserFromRequest } from '@/lib/auth';
import { encodeGeohash } from '@yon/shared';

type RouteContext = { params: Promise<{ id: string }> };

interface IncomingTarget {
  type?: unknown;
  target_id?: unknown;
}

export async function OPTIONS(req: NextRequest) {
  return corsPreflight(req.headers.get('origin'));
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  const origin = req.headers.get('origin');
  const user = await getUserFromRequest(req);
  // AUTH gate runs before any DB read.
  if (!user) return withCors(NextResponse.json({ error: 'unauthorized' }, { status: 401 }), origin);

  const { id } = await params;
  try {
    const body = await req.json().catch(() => ({}));
    const rawTargets: IncomingTarget[] = Array.isArray(body?.targets) ? body.targets : [];
    const types = rawTargets
      .map((t) => t?.type)
      .filter((t): t is string => t === 'geo' || t === 'family' || t === 'member');

    if (types.length === 0) {
      return withCors(NextResponse.json({ error: 'no_targets' }, { status: 400 }), origin);
    }

    // PRO GATE — family/member publishing requires pro. Runs BEFORE any write so a
    // free user can never publish to a person. geo (nearby) is not pro-gated.
    const needsPro = types.some((t) => t === 'family' || t === 'member');
    if (needsPro && user.plan !== 'pro') {
      return withCors(NextResponse.json({ error: 'pro_required' }, { status: 403 }), origin);
    }

    // OWNERSHIP — getTaste is scoped to the caller; a foreign id reads back null.
    const taste = await getTaste(user.id, id);
    if (!taste) return withCors(NextResponse.json({ error: 'Not found' }, { status: 404 }), origin);

    const wantsGeo = types.includes('geo');
    const hasCoords = typeof taste.lat === 'number' && typeof taste.lng === 'number';
    if (wantsGeo && !hasCoords) {
      // Can't publish a location-less record to "nearby"; never write a null geog.
      return withCors(NextResponse.json({ error: 'no_coordinates' }, { status: 422 }), origin);
    }

    // TARGET OWNERSHIP (record-poisoning guard) — a family/member target_id must
    // be one of the caller's OWN tasters/families. Without this a pro user could
    // publish to an arbitrary target_id (e.g. another account's id) and have the
    // row surface in that account's family feed. A missing/blank target_id is
    // also invalid (you can't publish to "nobody"). Reject unknown/unowned → 422.
    const personTargets = rawTargets.filter(
      (t) => t?.type === 'family' || t?.type === 'member',
    );
    const personTargetIds = personTargets.map((t) =>
      typeof t.target_id === 'string' ? t.target_id : '',
    );
    if (personTargetIds.some((tid) => tid.length === 0)) {
      return withCors(NextResponse.json({ error: 'invalid_target' }, { status: 422 }), origin);
    }
    if (personTargetIds.length > 0) {
      const unowned = await findUnownedShareTargets(user.id, personTargetIds);
      if (unowned.length > 0) {
        return withCors(NextResponse.json({ error: 'invalid_target' }, { status: 422 }), origin);
      }
    }

    // Build the writer payload. geo carries the DOUBLE-WRITE (precise lat/lng +
    // coarsened grid_cell computed here); family/member carry only target_id.
    const targets = rawTargets
      .filter((t) => t?.type === 'geo' || t?.type === 'family' || t?.type === 'member')
      .map((t) => {
        if (t.type === 'geo') {
          return {
            type: 'geo' as const,
            lat: taste.lat as number,
            lng: taste.lng as number,
            gridCell: encodeGeohash(taste.lat as number, taste.lng as number, 5),
          };
        }
        return {
          type: t.type as 'family' | 'member',
          targetId: typeof t.target_id === 'string' ? t.target_id : null,
        };
      });

    const updated = await setTasteVisibility(user.id, id, targets);
    if (!updated) return withCors(NextResponse.json({ error: 'Not found' }, { status: 404 }), origin);
    return withCors(NextResponse.json(updated), origin);
  } catch (err) {
    console.error(`PATCH /api/tastes/${id}/visibility error:`, err);
    return withCors(NextResponse.json({ error: 'Internal server error' }, { status: 500 }), origin);
  }
}
