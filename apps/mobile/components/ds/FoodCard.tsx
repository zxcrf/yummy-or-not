/* ============================================================
   YUMMY OR NOT — FoodCard (Tamagui / React Native)
   A single logged taste: photo, name, place, price, verdict, tags.
   Ported from the web DS. Props are compatible with the Taste shape
   from @yon/shared. The photo is a remote URL (Taste.image) rendered
   with React Native's built-in Image (no extra image dep needed).
   ============================================================ */

import { Image } from 'react-native'
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
  /** Display-quality image URL (≤1200 px). Falls back to `image` for old records. */
  imageDisplay?: string
  /** Legacy image URL — used as fallback when imageDisplay is absent. */
  image?: string
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
  imageDisplay,
  image,
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

  return (
    <CardFrame {...(onPress ? quick : {})} interactive={!!onPress} onPress={onPress} {...rest}>
      {/* media */}
      <View position="relative" backgroundColor="$paper2" aspectRatio={4 / 3}>
        {(imageDisplay || image) ? (
          <Image source={{ uri: imageDisplay || image }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
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
}

export default FoodCard
