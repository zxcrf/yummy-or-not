/* ============================================================
   Unit tests for imageKeyFromRow — the stable cache-key helper.
   ============================================================ */

import { imageKeyFromRow } from '../db';

const UUID = '123e4567-e89b-12d3-a456-426614174000';

describe('imageKeyFromRow', () => {
  it('returns "" for null', () => {
    expect(imageKeyFromRow(null)).toBe('');
  });

  it('returns "" for undefined', () => {
    expect(imageKeyFromRow(undefined)).toBe('');
  });

  it('returns "" for empty string', () => {
    expect(imageKeyFromRow('')).toBe('');
  });

  it('returns "" for http:// legacy URLs', () => {
    expect(imageKeyFromRow('http://example.com/photo.jpg')).toBe('');
  });

  it('returns "" for https:// legacy URLs', () => {
    expect(imageKeyFromRow('https://yon.baobao.click/uploads/photo.jpg')).toBe('');
  });

  it('returns "" for /uploads/ legacy paths', () => {
    expect(imageKeyFromRow('/uploads/local-file.jpg')).toBe('');
  });

  it('returns the key as-is for a bare flat key (pre-variant)', () => {
    expect(imageKeyFromRow(`${UUID}.jpg`)).toBe(`${UUID}.jpg`);
  });

  it('returns the key as-is for a variant orig key', () => {
    const key = `t/${UUID}/orig.jpg`;
    expect(imageKeyFromRow(key)).toBe(key);
  });

  it('returns the key as-is for a variant thumb key (raw DB value)', () => {
    // If somehow a thumb key ends up stored in the DB, pass it through —
    // the logic is purely about legacy vs bare-key, not about variant shape.
    const key = `t/${UUID}/thumb.webp`;
    expect(imageKeyFromRow(key)).toBe(key);
  });
});
