jest.mock('../storage', () => ({
  ...jest.requireActual('../storage'),
  getSignedPhotoUrl: jest.fn().mockResolvedValue(
    'https://yon-prod.s3.amazonaws.com/photos/abc.jpg?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=fakesig'
  ),
}));

jest.mock('../env', () => ({
  getPhotoStorage: jest.fn().mockReturnValue('s3'),
  getPhotoPublicBaseUrl: jest.fn().mockReturnValue(''),
  getPhotoCdnBaseUrl: jest.fn().mockReturnValue(''),
}));

import { resolvePhotoUrls } from '../db';
import { PRESIGN_TTL_SECONDS } from '../storage';

describe('resolvePhotoUrls (presigned)', () => {
  it('returns a promise (is async)', () => {
    const result = resolvePhotoUrls('photos/abc.jpg');
    expect(result).toBeInstanceOf(Promise);
  });

  it('returns presigned URLs with signature for bare flat key', async () => {
    const urls = await resolvePhotoUrls('photos/abc.jpg');
    expect(typeof urls.image).toBe('string');
    expect(urls.image).toContain('X-Amz-Signature');
    // flat key: all three fields are the same resolved URL
    expect(urls.imageThumb).toBe(urls.image);
    expect(urls.imageDisplay).toBe(urls.image);
  });

  it('keeps presigned URLs short lived', () => {
    expect(PRESIGN_TTL_SECONDS).toBe(3600);
  });

  it('passes through http(s) URLs unchanged', async () => {
    const urls = await resolvePhotoUrls('https://images.unsplash.com/photo.jpg');
    expect(urls.image).toBe('https://images.unsplash.com/photo.jpg');
    expect(urls.imageThumb).toBe(urls.image);
    expect(urls.imageDisplay).toBe(urls.image);
  });

  it('passes through /uploads/ paths unchanged', async () => {
    const urls = await resolvePhotoUrls('/uploads/local-file.jpg');
    expect(urls.image).toBe('/uploads/local-file.jpg');
    expect(urls.imageThumb).toBe(urls.image);
    expect(urls.imageDisplay).toBe(urls.image);
  });

  it('returns empty strings for null/undefined/empty', async () => {
    const empty = { image: '', imageThumb: '', imageDisplay: '' };
    expect(await resolvePhotoUrls(null)).toEqual(empty);
    expect(await resolvePhotoUrls(undefined)).toEqual(empty);
    expect(await resolvePhotoUrls('')).toEqual(empty);
  });

  it('falls back to base URL for bare flat key when storage is not s3', async () => {
    const { getPhotoStorage, getPhotoPublicBaseUrl } = require('../env') as {
      getPhotoStorage: jest.Mock;
      getPhotoPublicBaseUrl: jest.Mock;
    };
    getPhotoStorage.mockReturnValue('local');
    getPhotoPublicBaseUrl.mockReturnValue('http://localhost:3000');

    const urls = await resolvePhotoUrls('photos/local.jpg');
    expect(urls.image).toBe('http://localhost:3000/photos/local.jpg');
    expect(urls.imageThumb).toBe(urls.image);
    expect(urls.imageDisplay).toBe(urls.image);

    getPhotoStorage.mockReturnValue('s3');
    getPhotoPublicBaseUrl.mockReturnValue('');
  });
});
