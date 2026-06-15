/* ============================================================
   YUMMY OR NOT — compressAsset (shared native image pre-upload step)
   Extracted from AddModal so both the taste-photo path (AddModal) and the
   avatar path (YouView) compress/resize a picked asset identically before it
   is uploaded. Keep this the single source of truth — do not re-inline a copy.
   ============================================================ */

import * as ImagePicker from 'expo-image-picker'
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator'
import type { PhotoInput } from '@yon/shared'

/** Pull a sane filename + mime type off a picked native asset. */
export function rnFileFromAsset(asset: ImagePicker.ImagePickerAsset): PhotoInput {
  const type = asset.mimeType ?? 'image/jpeg'
  const name =
    asset.fileName ?? `photo.${type.includes('png') ? 'png' : 'jpg'}`
  return { uri: asset.uri, name, type }
}

/**
 * Compress and resize a native image asset before upload.
 * - Downscales to max 2560px wide (preserves aspect ratio; never upscales).
 * - Re-encodes as JPEG at quality 0.85.
 * Returns a new PhotoInput with the compressed uri and type 'image/jpeg'.
 * Falls back to the original asset on any error so the upload can still proceed.
 * expo-image-manipulator supports both native and web.
 */
export async function compressAsset(
  asset: ImagePicker.ImagePickerAsset,
): Promise<PhotoInput> {
  try {
    const MAX_WIDTH = 2560
    // Only add a resize action when the image actually exceeds the limit (never upscale).
    const actions = asset.width && asset.width > MAX_WIDTH
      ? [{ resize: { width: MAX_WIDTH } }]
      : []
    const result = await manipulateAsync(asset.uri, actions, {
      format: SaveFormat.JPEG,
      compress: 0.85,
    })
    const name = asset.fileName
      ? asset.fileName.replace(/\.[^.]+$/, '.jpg')
      : 'photo.jpg'
    return { uri: result.uri, name, type: 'image/jpeg' }
  } catch {
    // If compression fails for any reason, fall back to the original to avoid blocking the upload.
    return rnFileFromAsset(asset)
  }
}
