/* ============================================================
   YUMMY OR NOT — VerdictStamp (plain RN + StyleSheet)
   The slap-on verdict label (yum / meh / nah). Chunky bordered
   pill in the verdict color with an optional kaomoji face and
   the verdict word. No motion (static stamp).
   ============================================================ */

import { View, StyleSheet, type StyleProp, type ViewStyle, type ViewProps } from 'react-native'
import { Text } from '@/theme'
import { colors, radius, space } from '@/theme'
import type { Verdict } from '@yon/shared'

const FACES: Record<Verdict, string> = { yum: '◕‿◕', meh: '•_•', nah: '×_×' }
const LABELS: Record<Verdict, string> = { yum: 'YUM', meh: 'MEH', nah: 'NAH' }

// Resolved colors per verdict
const BG: Record<Verdict, string> = {
  yum: colors.verdictYum,
  meh: colors.verdictMeh,
  nah: colors.verdictNah,
}
const BORDER: Record<Verdict, string> = {
  yum: colors.verdictYum2,
  meh: colors.verdictMeh2,
  nah: colors.verdictNah2,
}

// Size → font size
const SIZE_FONT = { sm: 11, md: 14, lg: 18 } as const

// Size → padding/gap
const SIZE_PADDING = {
  sm: { paddingHorizontal: space[2], paddingVertical: space[1], gap: 4 },
  md: { paddingHorizontal: space[3], paddingVertical: space[2], gap: 6 },
  lg: { paddingHorizontal: space[4], paddingVertical: space[3], gap: 8 },
} as const

export interface VerdictStampProps extends Omit<ViewProps, 'style'> {
  verdict?: Verdict
  size?: 'sm' | 'md' | 'lg'
  /** Override the verdict word text. */
  label?: string
  /** Rotation in degrees; 0 = upright. */
  rotate?: number
  showFace?: boolean
  /** Style pass-through — caller can set position:'absolute', top, right, etc. */
  style?: StyleProp<ViewStyle>
}

/**
 * VerdictStamp — the slap-on verdict label (yum / meh / nah).
 */
export function VerdictStamp({
  verdict = 'yum',
  size = 'md',
  showFace = true,
  rotate = 0,
  label,
  style,
  ...rest
}: VerdictStampProps) {
  const fontSize = SIZE_FONT[size]
  const sizePad = SIZE_PADDING[size]

  return (
    <View
      style={[
        styles.base,
        {
          backgroundColor: BG[verdict],
          borderColor: BORDER[verdict],
          paddingHorizontal: sizePad.paddingHorizontal,
          paddingVertical: sizePad.paddingVertical,
          gap: sizePad.gap,
          transform: rotate ? [{ rotate: `${rotate}deg` }] : [],
        },
        style,
      ]}
      {...rest}
    >
      {showFace ? (
        <Text style={[styles.text, { fontSize, lineHeight: fontSize + 2 }]}>
          {FACES[verdict]}
        </Text>
      ) : null}
      <Text
        style={[
          styles.text,
          styles.label,
          { fontSize, lineHeight: fontSize + 2 },
        ]}
      >
        {label || LABELS[verdict]}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderWidth: 3,
    borderRadius: radius.sm,
  },
  text: {
    color: colors.ink900,
  },
  label: {
    fontWeight: '700',
    letterSpacing: 1,
  },
})

export default VerdictStamp
