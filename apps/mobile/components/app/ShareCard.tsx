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
import QRCode from 'react-native-qrcode-svg'
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
  /**
   * S3a importable share — the short import code PRINTED on the card so it
   * survives image-only forwarding (WeChat strips the deep link from forwarded
   * images, so the printed code is the ONLY channel that reaches the recipient).
   * Omitted for the plain S1 PNG share, where no code block is rendered.
   */
  importCode?: string
  /** Already-translated hint shown above the printed code (e.g. "Import in
   *  Yummy or Not with code"). Only used when importCode is set. */
  importCodeHint?: string
  /**
   * S3a 可导入 mode — the https landing URL for the token (e.g.
   * https://yon.baobao.click/i/<importCode>). When supplied, a QR encoding this
   * URL is rendered on the card so WeChat "识别图中二维码" jumps straight to the
   * import landing. OMITTED in pure-PNG mode: the plain image MUST stay
   * link-free (no scannable link embedded), so no QR is rendered.
   */
  landingUrl?: string
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
  { taste, verdictLabel, brandText, priceText, importCode, importCodeHint, landingUrl, onReady },
  ref,
) {
  const hasPhoto = !!(taste.imageThumb || taste.image)
  const photoUri = taste.imageThumb || taste.image || ''
  // 可导入 mode renders a QR (react-native-qrcode-svg). The image onLoad alone is
  // NOT a sufficient readiness gate then: the QR is a separate subtree that must
  // be laid out (and painted into the native backing view) before captureRef, or
  // the captured PNG omits it. We fire onReady from the qrWrap onLayout instead,
  // so the caller only captures once the QR block has a layout box.
  const hasQr = !!landingUrl

  // No-photo, no-QR path: signal ready after first paint so the caller's race
  // timer does not have to wait the full 600 ms fallback. When a QR is present
  // the qrWrap onLayout drives readiness instead (see below).
  useEffect(() => {
    if (!hasPhoto && !hasQr) onReady?.()
  }, [hasPhoto, hasQr, onReady])

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
            // When a QR is present, the qrWrap onLayout is the readiness gate
            // (the QR is the slow/late subtree); the image onLoad must NOT
            // pre-signal ready before the QR has laid out, or capture omits it.
            onLoad={hasQr ? undefined : onReady}
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

        {/* S3a importable share — the import code is PRINTED here so it rides
            the captured PNG and survives image-only forwarding (the deep link
            in the share text does not survive WeChat). This is the must-have
            delivery channel for the magic-word downgrade path. */}
        {importCode ? (
          <View style={styles.importBlock}>
            {importCodeHint ? (
              <Text style={styles.importHint}>{importCodeHint}</Text>
            ) : null}
            <Text style={styles.importCode}>{importCode}</Text>
            {/* 可导入 mode only: a QR encoding the https landing URL so WeChat
                "识别图中二维码" reaches the import landing without the deep link
                (which forwarded images strip). Pure-PNG mode passes no
                landingUrl, so no scannable link is ever embedded.

                MUST be standard dark-modules-on-light-background. An inverted QR
                (light modules on dark) is unreadable by most phone cameras and
                WeChat's scanner, which silently degrades 可导入 to a 淘口令-only
                share. The white qrWrap below also gives the code its quiet zone. */}
            {landingUrl ? (
              <View
                style={styles.qrWrap}
                // 可导入 readiness gate: the QR subtree has been laid out, so the
                // caller can capture knowing the QR block occupies the card.
                // Paired with a couple of rAF ticks in the caller so the SVG has
                // also painted into the native backing view before captureRef.
                onLayout={onReady}
              >
                {/* quietZone renders the spec-mandated blank margin INSIDE the
                    SVG (≈4 modules) so scanners lock on even when the white
                    qrWrap padding is tight — the wrapper padding alone is too
                    small for a ~29-module URL. */}
                <QRCode
                  value={landingUrl}
                  size={96}
                  quietZone={16}
                  backgroundColor="#fff"
                  color="#191017"
                />
              </View>
            ) : null}
          </View>
        ) : null}
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
  // Printed import code block — high contrast + monospace-ish spacing so the
  // code stays legible when the recipient reads it off a forwarded image.
  importBlock: {
    marginTop: 10,
    alignSelf: 'stretch',
    backgroundColor: '#191017',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignItems: 'center',
    gap: 2,
  },
  importHint: {
    fontSize: 10,
    color: '#d8cfd4',
    letterSpacing: 0.3,
  },
  importCode: {
    fontSize: 22,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: 4,
  },
  qrWrap: {
    marginTop: 8,
    padding: 8,
    borderRadius: 8,
    // White quiet zone around the standard dark-on-light QR so scanners lock on.
    backgroundColor: '#fff',
  },
})
