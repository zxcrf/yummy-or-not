jest.mock('../storage', () => ({
  ...jest.requireActual('../storage'),
  getSignedPhotoUrl: jest.fn().mockResolvedValue(
    'https://yon-prod.s3.amazonaws.com/photos/abc.jpg?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=fakesig'
  ),
}));

jest.mock('../env', () => ({
  getPhotoStorage: jest.fn().mockReturnValue('s3'),
  getPhotoPublicBaseUrl: jest.fn().mockReturnValue(''),
}));

import { resolvePhotoUrl } from '../db';
import { PRESIGN_TTL_SECONDS } from '../storage';

describe('resolvePhotoUrl (presigned)', () => {
  it('returns a promise (is async)', () => {
    const result = resolvePhotoUrl('photos/abc.jpg');
    expect(result).toBeInstanceOf(Promise);
  });

  it('returns a presigned URL with signature for bare key', async () => {
    const url = await resolvePhotoUrl('photos/abc.jpg');
    expect(typeof url).toBe('string');
    expect(url).toContain('X-Amz-Signature');
  });

  it('keeps presigned URLs short lived', () => {
    expect(PRESIGN_TTL_SECONDS).toBe(3600);
  });

  it('passes through http(s) URLs unchanged', async () => {
    const url = await resolvePhotoUrl('https://images.unsplash.com/photo.jpg');
    expect(url).toBe('https://images.unsplash.com/photo.jpg');
  });

  it('passes through /uploads/ paths unchanged', async () => {
    const url = await resolvePhotoUrl('/uploads/local-file.jpg');
    expect(url).toBe('/uploads/local-file.jpg');
  });

  it('returns empty string for null/undefined/empty', async () => {
    expect(await resolvePhotoUrl(null)).toBe('');
    expect(await resolvePhotoUrl(undefined)).toBe('');
    expect(await resolvePhotoUrl('')).toBe('');
  });

  it('falls back to base URL for bare key when storage is not s3', async () => {
    const { getPhotoStorage, getPhotoPublicBaseUrl } = require('../env') as {
      getPhotoStorage: jest.Mock;
      getPhotoPublicBaseUrl: jest.Mock;
    };
    getPhotoStorage.mockReturnValue('local');
    getPhotoPublicBaseUrl.mockReturnValue('http://localhost:3000');

    const url = await resolvePhotoUrl('photos/local.jpg');
    expect(url).toBe('http://localhost:3000/photos/local.jpg');

    getPhotoStorage.mockReturnValue('s3');
    getPhotoPublicBaseUrl.mockReturnValue('');
  });
});
