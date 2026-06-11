import { NextRequest } from 'next/server';

jest.mock('../db', () => ({
  updateUserSettings: jest.fn(),
}));

jest.mock('../auth', () => ({
  getUserFromRequest: jest.fn(),
}));

jest.mock('../cors', () => ({
  withCors: (res: Response) => res,
  corsPreflight: () => new Response(null, { status: 204 }),
}));

import { PATCH } from '../../app/api/user/route';
import { updateUserSettings } from '../db';
import { getUserFromRequest } from '../auth';

const mockedUpdateUserSettings = jest.mocked(updateUserSettings);
const mockedGetUserFromRequest = jest.mocked(getUserFromRequest);

function reqOf(body: object) {
  return new NextRequest('http://localhost/api/user', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const user = {
  id: 'u1',
  displayName: 'Alice',
  phone: '',
  email: 'a@example.com',
  avatar: '',
  locale: 'zh',
  plan: 'free' as const,
  warningsEnabled: true,
  locationEnabled: false,
  createdAt: '2026-01-01T00:00:00.000Z',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockedGetUserFromRequest.mockResolvedValue(user);
});

describe('PATCH /api/user displayName', () => {
  it('persists a valid displayName via updateUserSettings', async () => {
    mockedUpdateUserSettings.mockResolvedValue({ ...user, displayName: 'Kai Zhang' });

    const res = await PATCH(reqOf({ displayName: 'Kai Zhang' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockedUpdateUserSettings).toHaveBeenCalledWith('u1', { displayName: 'Kai Zhang' });
    expect(body.user.displayName).toBe('Kai Zhang');
  });

  it('trims whitespace before persisting', async () => {
    mockedUpdateUserSettings.mockResolvedValue({ ...user, displayName: 'Kai' });

    const res = await PATCH(reqOf({ displayName: '  Kai  ' }));

    expect(res.status).toBe(200);
    expect(mockedUpdateUserSettings).toHaveBeenCalledWith('u1', { displayName: 'Kai' });
  });

  it('returns 400 invalid_display_name for empty string', async () => {
    const res = await PATCH(reqOf({ displayName: '' }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('invalid_display_name');
    expect(mockedUpdateUserSettings).not.toHaveBeenCalled();
  });

  it('returns 400 invalid_display_name for whitespace-only string', async () => {
    const res = await PATCH(reqOf({ displayName: '   ' }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('invalid_display_name');
    expect(mockedUpdateUserSettings).not.toHaveBeenCalled();
  });

  it('returns 400 invalid_display_name for 61-character string', async () => {
    const res = await PATCH(reqOf({ displayName: 'a'.repeat(61) }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('invalid_display_name');
    expect(mockedUpdateUserSettings).not.toHaveBeenCalled();
  });

  it('accepts exactly 50-character displayName', async () => {
    const name50 = 'a'.repeat(50);
    mockedUpdateUserSettings.mockResolvedValue({ ...user, displayName: name50 });

    const res = await PATCH(reqOf({ displayName: name50 }));

    expect(res.status).toBe(200);
    expect(mockedUpdateUserSettings).toHaveBeenCalledWith('u1', { displayName: name50 });
  });

  it('returns 400 invalid_display_name for non-string displayName', async () => {
    const res = await PATCH(reqOf({ displayName: 42 }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('invalid_display_name');
    expect(mockedUpdateUserSettings).not.toHaveBeenCalled();
  });
});
