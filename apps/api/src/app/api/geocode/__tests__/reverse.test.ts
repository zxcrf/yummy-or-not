// Tests for GET /api/geocode/reverse route handler.
// Mocks: fetch (upstream providers), @/lib/auth, @/lib/cors, @yon/shared geo utils.

const mockGetUserFromRequest = jest.fn();
const mockFetch = jest.fn();

// Stub wgs84ToGcj02 and isInsideChina so tests are deterministic
const mockIsInsideChina = jest.fn();
const mockWgs84ToGcj02 = jest.fn((lat: number, lng: number) => ({ lat, lng }));

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: (...args: unknown[]) => mockGetUserFromRequest(...args),
}));

jest.mock('@/lib/cors', () => ({
  corsPreflight: jest.fn(() => new Response(null, { status: 204 })),
  withCors: jest.fn((_res: Response) => _res),
}));

jest.mock('@yon/shared', () => ({
  isInsideChina: (lat: number, lng: number) => mockIsInsideChina(lat, lng),
  wgs84ToGcj02: (lat: number, lng: number) => mockWgs84ToGcj02(lat, lng),
}));

// Patch global fetch
(globalThis as Record<string, unknown>).fetch = mockFetch;

import { GET } from '../reverse/route';
import { NextRequest } from 'next/server';

function makeReq(lat: string | null, lng: string | null, lang = 'en'): NextRequest {
  const url = new URL('http://localhost/api/geocode/reverse');
  if (lat !== null) url.searchParams.set('lat', lat);
  if (lng !== null) url.searchParams.set('lng', lng);
  return new NextRequest(url.toString(), {
    headers: { 'accept-language': lang },
  });
}

async function bodyOf(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

describe('GET /api/geocode/reverse', () => {
  const authedUser = { id: 'user-1', plan: 'free' };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.AMAP_KEY = 'test-amap-key';
    mockGetUserFromRequest.mockResolvedValue(authedUser);
  });

  it('returns 401 when not authenticated', async () => {
    mockGetUserFromRequest.mockResolvedValue(null);
    const req = makeReq('39.9', '116.4');
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it('returns 400 for invalid lat/lng', async () => {
    const res = await GET(makeReq('999', '116.4'));
    expect(res.status).toBe(400);
    const body = await bodyOf(res) as { error: string };
    expect(body.error).toBe('invalid_coords');
  });

  it('returns 400 when lat is missing', async () => {
    const res = await GET(makeReq(null, '116.4'));
    expect(res.status).toBe(400);
  });

  it('calls AMap with GCJ-02-converted location for China coords', async () => {
    mockIsInsideChina.mockReturnValue(true);
    mockWgs84ToGcj02.mockReturnValue({ lat: 39.9100, lng: 116.3990 });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        regeocode: { formatted_address: '北京市朝阳区某街道' },
      }),
    });

    const req = makeReq('39.9087', '116.3975');
    const res = await GET(req);
    expect(res.status).toBe(200);

    const body = await bodyOf(res) as { place: string; source: string };
    expect(body.place).toBe('北京市朝阳区某街道');
    expect(body.source).toBe('amap');

    // Verify AMap was called with GCJ-02 coords (lng,lat order) and our key
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('restapi.amap.com');
    // GCJ-02 values from the mock (trailing zeros stripped by JS number→string)
    expect(calledUrl).toContain('116.399');
    expect(calledUrl).toContain('39.91');
    expect(calledUrl).toContain('key=test-amap-key');
  });

  it('calls Nominatim with User-Agent for overseas coords', async () => {
    mockIsInsideChina.mockReturnValue(false);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        display_name: 'Tiger Sugar, Perth, Western Australia, Australia',
      }),
    });

    const req = makeReq('-31.9523', '115.8613', 'en-AU');
    const res = await GET(req);
    expect(res.status).toBe(200);

    const body = await bodyOf(res) as { place: string; source: string };
    expect(body.place).toBe('Tiger Sugar, Perth, Western Australia, Australia');
    expect(body.source).toBe('nominatim');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toContain('nominatim.openstreetmap.org');
    expect((calledInit.headers as Record<string, string>)['User-Agent']).toContain('yummy-or-not');
  });

  it('returns { place: null } with status 200 when provider throws', async () => {
    mockIsInsideChina.mockReturnValue(false);
    mockFetch.mockRejectedValueOnce(new Error('network error'));

    const req = makeReq('40.71', '-74.01');
    const res = await GET(req);
    expect(res.status).toBe(200);

    const body = await bodyOf(res) as { place: null };
    expect(body.place).toBeNull();
  });

  it('falls through to Nominatim when AMAP_KEY is unset for China coords', async () => {
    delete process.env.AMAP_KEY;
    mockIsInsideChina.mockReturnValue(true);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ display_name: 'Beijing, China' }),
    });

    const req = makeReq('39.9087', '116.3975');
    const res = await GET(req);
    expect(res.status).toBe(200);

    const body = await bodyOf(res) as { source: string };
    expect(body.source).toBe('nominatim');
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('nominatim.openstreetmap.org');
  });
});
