/* ============================================================
   YUMMY OR NOT — Avatar (plain RN + StyleSheet)
   Pixel-bordered profile chip. Shows cover image or initials.
   No motion (static display component).
   ============================================================ */

import React from 'react'
import {
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
  type ViewProps,
} from 'react-native'
import { Image } from 'expo-image'
import { colors, radius } from '@/theme'

export type AvatarSize = 'sm' | 'md' | 'lg'

export interface AvatarProps extends Omit<ViewProps, 'children' | 'style'> {
  /** Image URL. If absent, renders initials. */
  src?: string
  /** Display name used for initials and alt text. */
  name?: string
  /** Control size. */
  size?: AvatarSize
  /** Fully round instead of squared. */
  circle?: boolean
  /** Style pass-through reaches the frame container. */
  style?: StyleProp<ViewStyle>
}

const SIZE_PX: Record<AvatarSize, number> = { sm: 34, md: 44, lg: 64 }
const FONT_PX: Record<AvatarSize, number> = { sm: 14, md: 18, lg: 26 }

/**
 * Avatar — pixel-bordered profile chip. Shows an image or initials.
 */
export function Avatar({
  src,
  name = '',
  size = 'md',
  circle = false,
  style,
  ...rest
}: AvatarProps) {
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join('')
      .toUpperCase() || '?'

  const dim = SIZE_PX[size]

  return (
    <View
      style={[
        styles.frame,
        { width: dim, height: dim },
        circle && styles.circle,
        style,
      ]}
      {...rest}
    >
      {src ? (
        <Image
          source={{ uri: src }}
          style={{ width: dim, height: dim }}
          contentFit="cover"
          accessibilityLabel={name}
        />
      ) : (
        <Text style={[styles.initials, { fontSize: FONT_PX[size] }]}>
          {initials}
        </Text>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  frame: {
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    overflow: 'hidden',
    borderWidth: 3,
    borderColor: colors.ink900,
    borderRadius: radius.md,
    backgroundColor: colors.candyGrape,
  },
  circle: {
    borderRadius: radius.pill,
  },
  initials: {
    color: colors.onBrand,
    fontWeight: '700',
  },
})

export default Avatar
