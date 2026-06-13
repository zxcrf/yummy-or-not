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
  mediaEnabled: false,
  createdAt: '2026-01-01T00:00:00.000Z',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockedGetUserFromRequest.mockResolvedValue(user);
  mockedUpdateUserSettings.mockResolvedValue({ ...user, locationEnabled: true });
});

describe('PATCH /api/user locationEnabled', () => {
  it('accepts locationEnabled without requiring warningsEnabled', async () => {
    const res = await PATCH(reqOf({ locationEnabled: true }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockedUpdateUserSettings).toHaveBeenCalledWith('u1', { locationEnabled: true });
    expect(body.user.locationEnabled).toBe(true);
  });

  it('still accepts warningsEnabled', async () => {
    mockedUpdateUserSettings.mockResolvedValue({ ...user, warningsEnabled: false });

    const res = await PATCH(reqOf({ warningsEnabled: false }));

    expect(res.status).toBe(200);
    expect(mockedUpdateUserSettings).toHaveBeenCalledWith('u1', { warningsEnabled: false });
  });

  it('rejects non-boolean locationEnabled', async () => {
    const res = await PATCH(reqOf({ locationEnabled: 'true' }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('locationEnabled must be a boolean');
    expect(mockedUpdateUserSettings).not.toHaveBeenCalled();
  });
});
