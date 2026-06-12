/* ============================================================
   YUMMY OR NOT — Badge (plain RN + StyleSheet)
   Tiny pixel status pill. Six tones map to the candy/verdict palette.
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
import { colors, radius } from '@/theme'

export type BadgeTone = 'default' | 'yum' | 'meh' | 'nah' | 'dark' | 'pink'

export interface BadgeProps extends Omit<ViewProps, 'children' | 'style'> {
  /** Color tone. */
  tone?: BadgeTone
  /** Style pass-through reaches the pill container. */
  style?: StyleProp<ViewStyle>
  children?: React.ReactNode
}

const TONE_BG: Record<BadgeTone, string> = {
  default: colors.white,
  yum: colors.verdictYum,
  meh: colors.verdictMeh,
  nah: colors.verdictNah,
  dark: colors.ink900,
  pink: colors.brand,
}

const TONE_COLOR: Record<BadgeTone, string> = {
  default: colors.ink900,
  yum: colors.onBrand,
  meh: colors.ink900,
  nah: colors.onBrand,
  dark: colors.paper,
  pink: colors.onBrand,
}

/**
 * Badge — tiny pixel status pill.
 */
export function Badge({ tone = 'default', style, children, ...rest }: BadgeProps) {
  return (
    <View
      style={[styles.pill, { backgroundColor: TONE_BG[tone] }, style]}
      {...rest}
    >
      <Text style={[styles.label, { color: TONE_COLOR[tone] }]}>{children}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderWidth: 2,
    borderColor: colors.ink900,
    borderRadius: radius.pill,
    backgroundColor: colors.white,
  },
  label: {
    fontSize: 10,
    letterSpacing: 0.64,
    lineHeight: 12,
    textTransform: 'uppercase',
    color: colors.ink900,
  },
})

export default Badge
