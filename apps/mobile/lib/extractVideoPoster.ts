/* ============================================================
   YUMMY OR NOT — extractVideoPoster (S3b Phase 2, native)
   Extract a ~0.5s frame from a picked video clip and turn it into a JPEG
   poster (PhotoInput) that rides the normal taste-photo upload path.

   Pipeline (verified against Expo SDK 56 docs):
     1. createVideoPlayer(uri).generateThumbnailsAsync([0.5]) → VideoThumbnail.
        The thumbnail is a SharedRef<'image'> with NO `.uri` — it can only be
        consumed by expo-image / expo-image-manipulator directly.
     2. ImageManipulator.manipulate(thumb).renderAsync().saveAsync({JPEG}) →
        an ImageResult whose `.uri` IS a real file path. The legacy
        manipulateAsync(uri, …) used by compressAsset only accepts a uri string,
        so this context-API step is the bridge from SharedRef → uri.
     3. Feed that uri (as an ImagePickerAsset-shaped object) through the shared
        `compressAsset` so the poster is downscaled / re-encoded identically to
        every other taste photo (single source of truth — compressAsset stays
        unchanged).

   On ANY failure returns null — the caller must NOT block the upload; it falls
   back to a generic play-button placeholder and still uploads the clip.

   expo-video is a NATIVE module (no JS fallback), so this only runs on device;
   tests mock expo-video / expo-image-manipulator.
   ============================================================ */

import * as ImageManipulator from 'expo-image-manipulator'
import type { ImagePickerAsset } from 'expo-image-picker'
import { compressAsset } from '@/lib/compressAsset'
import type { PhotoInput } from '@yon/shared'

/** The ~0.5s timestamp (seconds) we sample the poster frame from. */
const POSTER_TIME_SECONDS = 0.5

/**
 * Extract a JPEG poster from a local video clip uri. Returns a PhotoInput ready
 * to upload as the taste `photo`, or null on any extraction failure (caller
 * uses a placeholder + still uploads the clip).
 */
export async function extractVideoPoster(
  clipUri: string,
): Promise<PhotoInput | null> {
  // Lazy require keeps expo-video (a native-only module) out of module-eval so
  // importing this file under non-native callers / tooling never pulls the
  // native binding at load time (mirrors uploadToPresignedUrl's lazy require).
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createVideoPlayer } = require('expo-video') as typeof import('expo-video')

  let player: ReturnType<typeof createVideoPlayer> | null = null
  try {
    player = createVideoPlayer(clipUri)
    const thumbnails = await player.generateThumbnailsAsync([POSTER_TIME_SECONDS])
    const frame = thumbnails[0]
    if (!frame) return null

    // SharedRef → file uri. The new context API is the only manipulator entry
    // that accepts a SharedRef source (the legacy manipulateAsync(uri,…) the
    // shared compressAsset uses takes a uri string only). `ImageManipulator` is
    // the native module object whose static `manipulate(source)` is documented
    // but not surfaced in the v56 typedef (only the `useImageManipulator` hook
    // is, which can't run inside this async picker fn), so we cast the static.
    const manipulate = (
      ImageManipulator.ImageManipulator as unknown as {
        manipulate(source: unknown): {
          renderAsync(): Promise<{ saveAsync(opts: ImageManipulator.SaveOptions): Promise<{ uri: string; width: number; height: number }> }>
        }
      }
    ).manipulate
    const context = manipulate(frame)
    const rendered = await context.renderAsync()
    const saved = await rendered.saveAsync({
      format: ImageManipulator.SaveFormat.JPEG,
      compress: 0.85,
    })

    // Run the saved frame through the shared compressAsset so the poster is
    // downscaled / re-encoded exactly like every other taste photo.
    const asset = {
      uri: saved.uri,
      width: saved.width,
      height: saved.height,
      fileName: 'poster.jpg',
      mimeType: 'image/jpeg',
    } as ImagePickerAsset
    return await compressAsset(asset)
  } catch {
    // Any failure (no native module, decode error, etc.) → no poster.
    return null
  } finally {
    // createVideoPlayer instances do NOT auto-release — always release.
    try {
      player?.release()
    } catch {
      // best-effort
    }
  }
}
