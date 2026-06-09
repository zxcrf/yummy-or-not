import { createHash } from 'crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { hitRateLimit } from '@/lib/db';
import { withCors } from '@/lib/cors';

export interface RateLimitRule {
  scope: string;
  identifier: string;
  limit: number;
  windowMs: number;
}

export interface RateLimitExceeded {
  limited: true;
  retryAfterSeconds: number;
}

export interface RateLimitAllowed {
  limited: false;
}

export type RateLimitResult = RateLimitAllowed | RateLimitExceeded;

export function clientIp(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]?.trim() || 'unknown';
  return req.headers.get('x-real-ip') ?? 'unknown';
}

export function rateLimitKey(scope: string, identifier: string): string {
  const normalized = `${scope}:${identifier.trim().toLowerCase()}`;
  return createHash('sha256').update(normalized).digest('hex');
}

export async function enforceRateLimits(rules: RateLimitRule[]): Promise<RateLimitResult> {
  let retryAfterSeconds = 0;
  for (const rule of rules) {
    const result = await hitRateLimit(
      rateLimitKey(rule.scope, rule.identifier),
      rule.limit,
      rule.windowMs
    );
    if (result.limited) {
      retryAfterSeconds = Math.max(retryAfterSeconds, result.retryAfterSeconds);
    }
  }
  return retryAfterSeconds > 0
    ? { limited: true, retryAfterSeconds }
    : { limited: false };
}

export function rateLimitedResponse(origin: string | null, retryAfterSeconds: number): NextResponse {
  const res = NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  res.headers.set('Retry-After', String(Math.max(1, retryAfterSeconds)));
  return withCors(res, origin);
}
