// Image variant generation for Yummy or Not.
//
// Storage layout:  t/{uuid}/orig.{ext}   — original upload
//                  t/{uuid}/thumb.webp   — 320 px thumbnail (70% quality)
//                  t/{uuid}/display.webp — 1280 px display copy (80% quality)
//
// All keys are relative; the storage layer maps them to their backend paths.
// sharp is loaded via a dynamic import so Next.js can exclude it from the
// client bundle and the standalone copy step can target the native binary.

/** Given an original key, return all three sibling keys. */
export function variantKeys(origKeyVal: string): {
  thumb: string;
  display: string;
  orig: string;
} {
  // origKey: t/{uuid}/orig.{ext}  -> prefix: t/{uuid}/
  const prefix = origKeyVal.substring(0, origKeyVal.lastIndexOf('/') + 1);
  return {
    orig: origKeyVal,
    thumb: `${prefix}thumb.webp`,
    display: `${prefix}display.webp`,
  };
}

/** Build the canonical orig key for a given uuid + file extension. */
export function origKey(uuid: string, ext: string): string {
  return `t/${uuid}/orig.${ext}`;
}

/** Sanitize a user-supplied filename into the `[a-z0-9]` extension charset that
 *  isVariantKey accepts. Without this, an ext like `jpg-large` would produce an
 *  orig key that fails isVariantKey, causing the resolver to treat it as a
 *  legacy flat key and emit the ORIGINAL in list/detail (and skip variant
 *  cleanup on delete). Falls back to `bin` when nothing usable remains. */
export function safeExt(filename: string): string {
  const dot = filename.lastIndexOf('.');
  if (dot < 0) return 'bin';
  const cleaned = filename.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '');
  return cleaned || 'bin';
}

/** Returns true when `v` looks like a canonical orig key we own. */
export function isVariantKey(v: string): boolean {
  return /^t\/[0-9a-f-]{36}\/orig\.[a-z0-9]+$/.test(v);
}

/** Transcode a raw upload buffer into thumb + display WebP variants. */
export async function makeVariants(
  buf: Buffer
): Promise<{ thumb: Buffer; display: Buffer }> {
  const { default: sharp } = await import('sharp');
  // .rotate() applies EXIF orientation before any resize.
  const base = sharp(buf, { failOn: 'none' }).rotate();

  const [thumb, display] = await Promise.all([
    base
      .clone()
      .resize({ width: 320, withoutEnlargement: true })
      .webp({ quality: 70 })
      .toBuffer(),
    base
      .clone()
      .resize({ width: 1280, withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer(),
  ]);

  return { thumb, display };
}
