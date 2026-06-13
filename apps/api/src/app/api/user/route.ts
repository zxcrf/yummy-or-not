// PATCH /api/user — update the signed-in user's settings.
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { updateUserSettings } from '@/lib/db';
import { withCors, corsPreflight } from '@/lib/cors';
import { getUserFromRequest } from '@/lib/auth';

export async function OPTIONS(req: NextRequest) {
  return corsPreflight(req.headers.get('origin'));
}

export async function PATCH(req: NextRequest) {
  const origin = req.headers.get('origin');
  const user = await getUserFromRequest(req);
  if (!user) return withCors(NextResponse.json({ error: 'unauthorized' }, { status: 401 }), origin);

  try {
    const body = await req.json().catch(() => ({}));
    const hasWarnings = Object.prototype.hasOwnProperty.call(body ?? {}, 'warningsEnabled');
    const hasLocation = Object.prototype.hasOwnProperty.call(body ?? {}, 'locationEnabled');
    const hasDisplayName = Object.prototype.hasOwnProperty.call(body ?? {}, 'displayName');
    const hasVisibility = Object.prototype.hasOwnProperty.call(body ?? {}, 'defaultVisibility');

    if (hasWarnings && typeof body?.warningsEnabled !== 'boolean') {
      return withCors(
        NextResponse.json({ error: 'warningsEnabled must be a boolean' }, { status: 400 }),
        origin
      );
    }
    if (hasLocation && typeof body?.locationEnabled !== 'boolean') {
      return withCors(
        NextResponse.json({ error: 'locationEnabled must be a boolean' }, { status: 400 }),
        origin
      );
    }
    if (hasDisplayName) {
      const raw = body?.displayName;
      if (typeof raw !== 'string') {
        return withCors(
          NextResponse.json({ error: 'invalid_display_name' }, { status: 400 }),
          origin
        );
      }
      const trimmed = raw.trim();
      if (trimmed.length < 1 || trimmed.length > 50) {
        return withCors(
          NextResponse.json({ error: 'invalid_display_name' }, { status: 400 }),
          origin
        );
      }
    }
    if (hasVisibility && body?.defaultVisibility !== 'private' && body?.defaultVisibility !== 'shared') {
      return withCors(
        NextResponse.json({ error: 'invalid_default_visibility' }, { status: 400 }),
        origin
      );
    }
    if (!hasWarnings && !hasLocation && !hasDisplayName && !hasVisibility) {
      return withCors(
        NextResponse.json({ error: 'warningsEnabled or locationEnabled must be a boolean' }, { status: 400 }),
        origin
      );
    }

    const updated = await updateUserSettings(user.id, {
      ...(hasWarnings ? { warningsEnabled: body.warningsEnabled } : {}),
      ...(hasLocation ? { locationEnabled: body.locationEnabled } : {}),
      ...(hasDisplayName ? { displayName: (body.displayName as string).trim() } : {}),
      ...(hasVisibility ? { defaultVisibility: body.defaultVisibility as 'private' | 'shared' } : {}),
    });
    if (!updated) {
      return withCors(NextResponse.json({ error: 'not_found' }, { status: 404 }), origin);
    }
    return withCors(NextResponse.json({ user: updated }), origin);
  } catch (err) {
    console.error('PATCH /api/user error:', err);
    return withCors(NextResponse.json({ error: 'Internal server error' }, { status: 500 }), origin);
  }
}
