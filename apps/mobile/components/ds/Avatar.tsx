/* ============================================================
   YUMMY OR NOT — Avatar (Tamagui / React Native)
   Pixel-bordered profile chip. Ported from the web DS: a chunky
   ink-bordered square (or circle) on candy-grape; shows a cover
   image when `src` is set, otherwise up to two derived initials.
   ============================================================ */

import { type GetProps, Image, styled, Text, View } from 'tamagui'

const Frame = styled(View, {
  name: 'Avatar',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  overflow: 'hidden',
  borderWidth: 3,
  borderColor: '$ink900',
  borderRadius: '$md',
  backgroundColor: '$candyGrape',

  variants: {
    size: {
      sm: { width: 34, height: 34 },
      md: { width: 44, height: 44 },
      lg: { width: 64, height: 64 },
    },
    circle: {
      true: { borderRadius: '$pill' },
    },
  } as const,

  defaultVariants: {
    size: 'md',
  },
})

export type AvatarSize = 'sm' | 'md' | 'lg'

const SIZE_PX: Record<AvatarSize, number> = { sm: 34, md: 44, lg: 64 }
const FONT_PX: Record<AvatarSize, number> = { sm: 14, md: 18, lg: 26 }

export type AvatarProps = Omit<GetProps<typeof Frame>, 'size'> & {
  /** Image URL. If absent, renders initials. */
  src?: string
  /** Display name used for initials and alt text. */
  name?: string
  /** Control size. */
  size?: AvatarSize
  /** Fully round instead of squared. */
  circle?: boolean
}

/**
 * Avatar — pixel-bordered profile chip. Shows an image or initials.
 */
export function Avatar({ src, name = '', size = 'md', circle = false, ...rest }: AvatarProps) {
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join('')
      .toUpperCase() || '?'

  return (
    <Frame size={size} circle={circle} {...rest}>
      {src ? (
        <Image
          source={{ uri: src }}
          width={SIZE_PX[size]}
          height={SIZE_PX[size]}
          resizeMode="cover"
          accessibilityLabel={name}
        />
      ) : (
        <Text color="$onBrand" fontWeight="700" fontSize={FONT_PX[size]}>
          {initials}
        </Text>
      )}
    </Frame>
  )
}

export default Avatar
