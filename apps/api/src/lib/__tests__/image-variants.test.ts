/* ============================================================
   Unit tests for image-variants lib — variantKeys, isVariantKey,
   and makeVariants (the sharp transcode pipeline).

   These tests exercise the real module with no mocks of image-variants
   itself so makeVariants runs through the actual sharp implementation.
   ============================================================ */

import { makeVariants, variantKeys, isVariantKey, safeExt, origKey } from '../image-variants';

const UUID = '123e4567-e89b-12d3-a456-426614174000';

// ── safeExt ──────────────────────────────────────────────────────────────────

describe('safeExt', () => {
  it('lowercases a normal extension', () => {
    expect(safeExt('photo.JPG')).toBe('jpg');
    expect(safeExt('IMG.png')).toBe('png');
  });

  it('strips non-alphanumeric chars so the orig key stays isVariantKey-valid', () => {
    /* Regression: an ext like `jpg-large` left unsanitized produced an orig key
       that failed isVariantKey -> resolver treated it as legacy and emitted the
       ORIGINAL in list/detail. safeExt must reduce it to [a-z0-9]. */
    expect(safeExt('photo.jpg-large')).toBe('jpglarge');
    expect(isVariantKey(origKey(UUID, safeExt('photo.jpg-large')))).toBe(true);
    expect(isVariantKey(origKey(UUID, safeExt('x.jpg?v=2')))).toBe(true);
  });

  it('falls back to bin when no usable extension remains', () => {
    expect(safeExt('noext')).toBe('bin');
    expect(safeExt('weird.@@@')).toBe('bin');
  });
});

// ── variantKeys ──────────────────────────────────────────────────────────────

describe('variantKeys', () => {
  it('derives thumb and display sibling keys from an orig key', () => {
    const ok = `t/${UUID}/orig.jpg`;
    const keys = variantKeys(ok);
    expect(keys.orig).toBe(ok);
    expect(keys.thumb).toBe(`t/${UUID}/thumb.webp`);
    expect(keys.display).toBe(`t/${UUID}/display.webp`);
  });

  it('handles different file extensions', () => {
    const ok = `t/${UUID}/orig.png`;
    const { thumb, display } = variantKeys(ok);
    expect(thumb).toBe(`t/${UUID}/thumb.webp`);
    expect(display).toBe(`t/${UUID}/display.webp`);
  });
});

// ── isVariantKey ─────────────────────────────────────────────────────────────

describe('isVariantKey', () => {
  it('returns true for a canonical orig key', () => {
    expect(isVariantKey(`t/${UUID}/orig.jpg`)).toBe(true);
    expect(isVariantKey(`t/${UUID}/orig.webp`)).toBe(true);
    expect(isVariantKey(`t/${UUID}/orig.png`)).toBe(true);
  });

  it('returns false for a flat (pre-variant) UUID key', () => {
    expect(isVariantKey('abc123.jpg')).toBe(false);
    expect(isVariantKey(`${UUID}.jpg`)).toBe(false);
  });

  it('returns false for absolute http/https URLs', () => {
    expect(isVariantKey('https://example.com/photo.jpg')).toBe(false);
    expect(isVariantKey('http://example.com/photo.jpg')).toBe(false);
  });

  it('returns false for /uploads/ paths', () => {
    expect(isVariantKey('/uploads/local-file.jpg')).toBe(false);
  });

  it('returns false for thumb/display sibling keys (not orig)', () => {
    // Regression: only "orig.*" qualifies; thumb/display must not pass.
    expect(isVariantKey(`t/${UUID}/thumb.webp`)).toBe(false);
    expect(isVariantKey(`t/${UUID}/display.webp`)).toBe(false);
  });
});

// ── makeVariants ─────────────────────────────────────────────────────────────

describe('makeVariants', () => {
  it('produces webp buffers for thumb and display', async () => {
    // 1×1 white PNG — minimal valid input for sharp.
    // prettier-ignore
    const PNG_1x1 = Buffer.from(
      '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489' +
      '0000000a49444154789c6260000000020001e221bc330000000049454e44ae426082',
      'hex',
    );

    const { thumb, display } = await makeVariants(PNG_1x1);

    expect(Buffer.isBuffer(thumb)).toBe(true);
    expect(Buffer.isBuffer(display)).toBe(true);
    expect(thumb.length).toBeGreaterThan(0);
    expect(display.length).toBeGreaterThan(0);

    // WebP magic: RIFF....WEBP
    const isWebp = (buf: Buffer) =>
      buf.slice(0, 4).toString('ascii') === 'RIFF' &&
      buf.slice(8, 12).toString('ascii') === 'WEBP';
    expect(isWebp(thumb)).toBe(true);
    expect(isWebp(display)).toBe(true);
  });

  it('does not upscale a small input (withoutEnlargement)', async () => {
    const sharp = (await import('sharp')).default;
    const smallBuf = await sharp({
      create: { width: 10, height: 10, channels: 3, background: { r: 255, g: 0, b: 0 } },
    })
      .png()
      .toBuffer();

    const { thumb, display } = await makeVariants(smallBuf);

    const thumbMeta = await sharp(thumb).metadata();
    const displayMeta = await sharp(display).metadata();

    // Both variants must stay at or below the original 10 px width.
    expect(thumbMeta.width).toBeLessThanOrEqual(10);
    expect(displayMeta.width).toBeLessThanOrEqual(10);
  });

  it('caps thumb at 320 px and display at 1280 px for large input', async () => {
    const sharp = (await import('sharp')).default;
    const largeBuf = await sharp({
      create: { width: 2000, height: 2000, channels: 3, background: { r: 0, g: 0, b: 255 } },
    })
      .png()
      .toBuffer();

    const { thumb, display } = await makeVariants(largeBuf);

    const thumbMeta = await sharp(thumb).metadata();
    const displayMeta = await sharp(display).metadata();

    expect(thumbMeta.width).toBe(320);
    expect(displayMeta.width).toBe(1280);
  });
});
