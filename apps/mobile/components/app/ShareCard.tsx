/* ============================================================
   YUMMY OR NOT — ShareCard (React Native)
   Pure presentational card captured off-screen via react-native-view-shot
   and shared via expo-sharing. Fixed width 360 so pixelRatio:2 always
   produces a 720px PNG regardless of device density.

   Props come in already-translated (verdictLabel, brandText) so the
   capture path has no i18n dependency at render time.
   ============================================================ */

import { forwardRef, useEffect } from 'react'
import { Image, StyleSheet, View } from 'react-native'
import { Text } from '@/theme'
import { Image as ExpoImage } from 'expo-image'
import type { Taste, Verdict } from '@yon/shared'
import { VerdictStamp } from '@/components/ds'

// Resolved hex values for verdict background colors (cannot use Tamagui tokens
// in a captured off-screen tree — the provider is not mounted around it).
const VERDICT_BG: Record<Verdict, string> = {
  yum: '#14c46b',
  meh: '#ffb20e',
  nah: '#ff3147',
}

export type ShareCardProps = {
  taste: Taste
  verdictLabel: string
  brandText: string
  priceText: string
  /** Called once the card is ready to capture: image loaded (or no photo). */
  onReady?: () => void
}

/**
 * ShareCard — off-screen branded layout captured to PNG and shared.
 * Must be wrapped in a ref-bearing View with collapsable={false} by
 * the caller so captureRef can read the native backing view.
 *
 * Calls onReady when the card is ready to capture:
 * - With photo: fires on expo-image onLoad (image pixels in backing view).
 * - No photo: fires synchronously via useEffect after first paint.
 */
export const ShareCard = forwardRef<View, ShareCardProps>(function ShareCard(
  { taste, verdictLabel, brandText, priceText, onReady },
  ref,
) {
  const hasPhoto = !!(taste.imageThumb || taste.image)
  const photoUri = taste.imageThumb || taste.image || ''

  // No-photo path: signal ready after first paint so the caller's race
  // timer does not have to wait the full 600 ms fallback.
  useEffect(() => {
    if (!hasPhoto) onReady?.()
  }, [hasPhoto, onReady])

  return (
    <View ref={ref} style={styles.card} collapsable={false}>
      {/* Photo block (4:3) or no-photo solid header */}
      {hasPhoto ? (
        <View style={styles.photoWrapper}>
          <ExpoImage
            source={{
              uri: photoUri,
              ...(taste.imageKey ? { cacheKey: `${taste.imageKey}:thumb` } : {}),
            }}
            cachePolicy="disk"
            style={styles.photo}
            contentFit="cover"
            onLoad={onReady}
          />
          {/* VerdictStamp overlapping the photo bottom edge */}
          <View style={styles.stampOverPhoto}>
            <VerdictStamp
              verdict={taste.verdict ?? 'yum'}
              size="lg"
              rotate={-5}
              label={verdictLabel}
            />
          </View>
        </View>
      ) : (
        <View
          style={[
            styles.noPhotoHeader,
            { backgroundColor: VERDICT_BG[taste.verdict ?? 'yum'] },
          ]}
        >
          <VerdictStamp
            verdict={taste.verdict ?? 'yum'}
            size="lg"
            rotate={-5}
            label={verdictLabel}
          />
        </View>
      )}

      {/* Text content */}
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={2} ellipsizeMode="tail">
          {taste.name}
        </Text>

        <View style={styles.metaRow}>
          {taste.place ? (
            <Text style={styles.place} numberOfLines={1} ellipsizeMode="tail">
              {taste.place}
            </Text>
          ) : null}
          {priceText ? (
            <Text style={styles.price}>{priceText}</Text>
          ) : null}
        </View>

        {/* Brand badge */}
        <View style={styles.brandBadge}>
          <Text style={styles.brandText}>{brandText}</Text>
        </View>
      </View>
    </View>
  )
})

const CARD_WIDTH = 360

const styles = StyleSheet.create({
  card: {
    width: CARD_WIDTH,
    backgroundColor: '#fff',
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#191017',
  },
  // 4:3 aspect ratio photo block
  photoWrapper: {
    width: CARD_WIDTH,
    height: CARD_WIDTH * (3 / 4), // 270
    position: 'relative',
  },
  photo: {
    width: '100%',
    height: '100%',
  },
  stampOverPhoto: {
    position: 'absolute',
    left: 14,
    bottom: -14,
  },
  // No-photo fallback: verdict-color header at half photo height
  noPhotoHeader: {
    width: CARD_WIDTH,
    height: CARD_WIDTH * (3 / 8), // 135 — half the photo height
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    paddingHorizontal: 16,
    paddingTop: 22,
    paddingBottom: 16,
    gap: 6,
  },
  name: {
    fontSize: 20,
    fontWeight: '700',
    color: '#191017',
    lineHeight: 24,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  place: {
    fontSize: 13,
    color: '#7a6d76',
    flex: 1,
  },
  price: {
    fontSize: 13,
    fontWeight: '700',
    color: '#191017',
  },
  brandBadge: {
    alignSelf: 'flex-start',
    marginTop: 4,
    backgroundColor: '#f5f0f4',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: '#e0d8dd',
  },
  brandText: {
    fontSize: 11,
    color: '#7a6d76',
    letterSpacing: 0.3,
  },
})
