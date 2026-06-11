/* ============================================================
   YUMMY OR NOT — FoodCard (Tamagui / React Native)
   A single logged taste: photo, name, place, price, verdict, tags.
   Ported from the web DS. Props are compatible with the Taste shape
   from @yon/shared. The photo is a remote URL rendered with expo-image
   so a stable cacheKey (Taste.imageKey) survives the per-request signed
   query and serves from the on-disk cache.
   ============================================================ */

import { Image } from 'expo-image'
import { Pressable } from 'react-native'
import { type GetProps, View, styled, Text } from 'tamagui'
import { quick } from './animation'
import type { Verdict } from '@yon/shared'
import { VerdictStamp } from './VerdictStamp'
import { Tag } from './Tag'

const CardFrame = styled(View, {
  name: 'FoodCard',
  backgroundColor: '$white',
  borderWidth: 3,
  borderColor: '$ink900',
  borderRadius: '$lg',
  overflow: 'hidden',
  shadowColor: '$ink900',
  shadowOffset: { width: 5, height: 5 },
  shadowOpacity: 1,
  shadowRadius: 0,

  variants: {
    interactive: {
      true: {
        cursor: 'pointer',
        animation: 'quick',
        pressStyle: {
          scale: 0.98,
          shadowOffset: { width: 3, height: 3 },
        },
      },
    },
  } as const,
})

export type FoodCardProps = Omit<GetProps<typeof CardFrame>, 'children'> & {
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
  verdict?: Verdict
  tags?: string[]
  /** How many times purchased. */
  boughtCount?: number
  /** Override "Bought N×" text. */
  boughtLabel?: string
  /** Override the verdict word on the stamp. */
  verdictLabel?: string
  onPress?: () => void
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
  onPress,
  ...rest
}: FoodCardProps) {
  const normalizedTags = normalizeTags(tags)
  const content = (pressed: boolean) => (
    <CardFrame
      {...(onPress ? quick : {})}
      interactive={!!onPress}
      scale={pressed ? 0.98 : 1}
      shadowOffset={pressed ? { width: 3, height: 3 } : { width: 5, height: 5 }}
      {...rest}
    >
      {/* media */}
      <View position="relative" backgroundColor="$paper2" aspectRatio={4 / 3}>
        {(imageThumb || image) ? (
          <Image
            source={{
              uri: imageThumb || image,
              ...(imageKey ? { cacheKey: `${imageKey}:thumb` } : {}),
            }}
            cachePolicy="disk"
            transition={150}
            style={{ width: '100%', height: '100%' }}
            contentFit="cover"
          />
        ) : null}
        <VerdictStamp
          verdict={verdict}
          size="sm"
          label={verdictLabel}
          rotate={-6}
          position="absolute"
          top="$2"
          right="$2"
        />
      </View>

      {/* body */}
      <View padding="$3" gap="$2">
        <View flexDirection="row" alignItems="center" justifyContent="space-between" gap="$2">
          <Text color="$ink900" fontWeight="700" fontSize={16} flexShrink={1}>
            {name}
          </Text>
          {price != null ? (
            <Text color="$ink900" fontWeight="700" fontSize={16}>
              {price}
            </Text>
          ) : null}
        </View>

        {place ? (
          <Text color="$colorMuted" fontSize={13}>
            {place}
          </Text>
        ) : null}

        {normalizedTags.length > 0 || boughtCount ? (
          <View flexDirection="row" flexWrap="wrap" gap="$2" marginTop="$1">
            {boughtCount ? (
              <Tag>{boughtLabel || `Bought ${boughtCount}×`}</Tag>
            ) : null}
            {normalizedTags.map((t) => (
              <Tag key={t}>{t}</Tag>
            ))}
          </View>
        ) : null}
      </View>
    </CardFrame>
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

export default FoodCard
