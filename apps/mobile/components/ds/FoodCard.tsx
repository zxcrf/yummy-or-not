/* ============================================================
   YUMMY OR NOT — FoodCard (plain RN + StyleSheet)
   A single logged taste: photo, name, place, price, verdict, tags.
   Props are compatible with the Taste shape from @yon/shared.
   The photo is a remote URL rendered with expo-image so a stable
   cacheKey (Taste.imageKey) survives the per-request signed-URL
   rotation and serves from the on-disk cache.

   Press motion: manual `pressed` render-prop → scale 0.98 +
   shadowOffset collapse (no animation hook — §1.3b exception).
   ============================================================ */

import { Image } from 'expo-image'
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle, type ViewProps } from 'react-native'
import { Text } from '@/theme'
import type { TasteStatus, Verdict } from '@yon/shared'
import { colors, radius, space } from '@/theme'
import { VerdictStamp } from './VerdictStamp'
import { Tag } from './Tag'

export interface FoodCardProps extends Omit<ViewProps, 'style'> {
  /** Thumbnail image URL (≤300 px). Falls back to `image` for old records. */
  imageThumb?: string
  /** Legacy image URL — used as fallback when imageThumb is absent. */
  image?: string
  /** Stable storage key of the photo. When present, used to derive a cache key
   *  (`${imageKey}:thumb`) so the disk cache survives the signed-URL rotation. */
  imageKey?: string
  /** Food or drink name. */
  name?: string
  /** Place/vendor name. */
  place?: string
  /** Display price string, e.g. "$5.80". */
  price?: string
  /** Nullable for todo rows (status==='todo'). When null, renders todoLabel badge instead of VerdictStamp. */
  verdict?: Verdict | null
  tags?: string[]
  /** How many times purchased. */
  boughtCount?: number
  /** Override "Bought N×" text. */
  boughtLabel?: string
  /** Override the verdict word on the stamp. */
  verdictLabel?: string
  /** Badge text for todo (想吃) rows. Rendered when status==='todo', regardless of verdict. */
  todoLabel?: string
  /** Taste status — drives badge vs stamp decision. When 'todo', todoLabel takes precedence over verdict. */
  status?: TasteStatus
  onPress?: () => void
  /** Style pass-through applied to the outermost card frame. */
  style?: StyleProp<ViewStyle>
}

/**
 * Normalise a tags array so that legacy entries whose value is a JSON-encoded
 * array string (e.g. '["Dessert"]') are exploded into individual tag strings.
 */
function normalizeTags(tags: string[]): string[] {
  const result: string[] = []
  for (const t of tags) {
    const trimmed = t.trim()
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed)
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (typeof item === 'string' && item.trim()) {
              result.push(item.trim())
            }
          }
          continue
        }
      } catch {
        // fall through to use tag as-is
      }
    }
    if (trimmed) result.push(trimmed)
  }
  return result
}

/**
 * FoodCard — a single logged taste: photo, name, place, price, verdict, tags.
 */
export function FoodCard({
  imageThumb,
  image,
  imageKey,
  name,
  place,
  price,
  verdict = 'yum',
  tags = [],
  boughtCount,
  boughtLabel,
  verdictLabel,
  todoLabel,
  status,
  onPress,
  style,
  // Strip Tamagui-era props that JS/any callers may still forward.
  // These are not part of FoodCardProps but could arrive via an untyped
  // boundary; if forwarded to the inner View they'd re-register a touch
  // responder and swallow taps (same regression as the old `interactive` variant).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ...rest
}: FoodCardProps & { interactive?: any; pressStyle?: any }) {
  // Consume and discard any stale Tamagui-era props before spreading rest
  const { interactive: _interactive, pressStyle: _pressStyle, ...safeRest } = rest as any
  const normalizedTags = normalizeTags(tags)

  const content = (pressed: boolean) => (
    // NOTE: do NOT put a touch responder on the inner frame. The pressed visual
    // is driven manually by the `pressed` boolean from the outer Pressable
    // render-prop: scale 0.98 + shadowOffset collapse. No usePressNudge hook
    // here (§1.3b exception for FoodCard).
    <View
      style={[
        styles.frame,
        // Caller style placed BEFORE the press transform so that a caller
        // transform cannot silently override the pressed-scale visual.
        style,
        pressed
          ? { transform: [{ scale: 0.98 }], shadowOffset: { width: 3, height: 3 } }
          : { transform: [{ scale: 1 }], shadowOffset: { width: 5, height: 5 } },
      ]}
      {...safeRest}
    >
      {/* media */}
      <View style={styles.mediaContainer}>
        {(imageThumb || image) ? (
          <Image
            source={{
              uri: imageThumb || image,
              ...(imageKey ? { cacheKey: `${imageKey}:thumb` } : {}),
            }}
            cachePolicy="disk"
            transition={150}
            style={styles.image}
            contentFit="cover"
          />
        ) : null}
        {status === 'todo' ? (
          todoLabel != null ? (
            <Tag
              style={{ position: 'absolute', top: space[2], right: space[2] }}
            >
              {todoLabel}
            </Tag>
          ) : null
        ) : verdict != null ? (
          <VerdictStamp
            verdict={verdict}
            size="sm"
            label={verdictLabel}
            rotate={-6}
            style={{ position: 'absolute', top: space[2], right: space[2] }}
          />
        ) : null}
      </View>

      {/* body */}
      <View style={styles.body}>
        <View style={styles.nameRow}>
          <Text style={styles.nameText}>
            {name}
          </Text>
          {price != null ? (
            <Text style={styles.priceText}>
              {price}
            </Text>
          ) : null}
        </View>

        {place ? (
          <Text style={styles.placeText}>
            {place}
          </Text>
        ) : null}

        {normalizedTags.length > 0 || boughtCount ? (
          <View style={styles.tagsRow}>
            {boughtCount ? (
              <Tag>{boughtLabel || `Bought ${boughtCount}×`}</Tag>
            ) : null}
            {normalizedTags.map((t) => (
              <Tag key={t}>{t}</Tag>
            ))}
          </View>
        ) : null}
      </View>
    </View>
  )

  if (!onPress) {
    return content(false)
  }

  return (
    <Pressable onPress={onPress} accessibilityRole="button">
      {({ pressed }) => content(pressed)}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  frame: {
    backgroundColor: colors.white,
    borderWidth: 3,
    borderColor: colors.ink900,
    borderRadius: radius.lg,
    overflow: 'hidden',
    shadowColor: colors.ink900,
    shadowOpacity: 1,
    shadowRadius: 0,
  },
  mediaContainer: {
    position: 'relative',
    backgroundColor: colors.paper2,
    aspectRatio: 4 / 3,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  body: {
    padding: space[3],
    gap: space[2],
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[2],
  },
  nameText: {
    color: colors.ink900,
    fontWeight: '700',
    fontSize: 16,
    flexShrink: 1,
  },
  priceText: {
    color: colors.ink900,
    fontWeight: '700',
    fontSize: 16,
  },
  placeText: {
    color: colors.colorMuted,
    fontSize: 13,
  },
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space[2],
    marginTop: space[1],
  },
})

export default FoodCard
