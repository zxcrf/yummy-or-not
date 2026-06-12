/* ============================================================
   YUMMY OR NOT — VerdictPicker (plain RN + StyleSheet + Reanimated)
   The core capture interaction: tap yum / meh / nah. Controlled via
   `value` + `onChange(key)`. Three big bordered buttons in the verdict
   colors; the selected one pops (filled + hard offset shadow), the rest
   sit flat on paper.
   Press motion: usePressScale(bouncy) 0.95.
   §1.3b event-composition contract enforced.
   ============================================================ */

import React from 'react'
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
  type ViewProps,
} from 'react-native'
import Animated from 'react-native-reanimated'
import { colors, radius, space, bouncy, usePressScale } from '@/theme'
import type { Verdict } from '@yon/shared'

const OPTS: { key: Verdict; face: string; label: string }[] = [
  { key: 'yum', face: '◕‿◕', label: 'YUM' },
  { key: 'meh', face: '•_•', label: 'MEH' },
  { key: 'nah', face: '×_×', label: 'NAH' },
]

// Resolved colors per verdict
const OPT_BG: Record<Verdict, string> = {
  yum: colors.verdictYum,
  meh: colors.verdictMeh,
  nah: colors.verdictNah,
}
const OPT_BORDER: Record<Verdict, string> = {
  yum: colors.verdictYum2,
  meh: colors.verdictMeh2,
  nah: colors.verdictNah2,
}

// Shadow for selected state (hard offset, no blur)
const SELECTED_SHADOW = {
  shadowColor: colors.ink900,
  shadowOffset: { width: 4, height: 4 },
  shadowOpacity: 1 as const,
  shadowRadius: 0,
}

export interface VerdictPickerProps extends Omit<ViewProps, 'style'> {
  /** Currently selected verdict. */
  value?: Verdict | null
  /** Called with the chosen verdict key. */
  onChange?: (verdict: Verdict) => void
  /** Override the display labels. */
  labels?: Partial<Record<Verdict, string>>
  /** Style pass-through on the outer row container. */
  style?: StyleProp<ViewStyle>
}

// ---------- Single option item ----------

interface OptItemProps {
  opt: (typeof OPTS)[number]
  selected: boolean
  onSelect: () => void
  onPressIn?: PressableProps['onPressIn']
  onPressOut?: PressableProps['onPressOut']
  label?: string
}

function OptItem({ opt, selected, onSelect, onPressIn: callerIn, onPressOut: callerOut, label }: OptItemProps) {
  const driver = usePressScale({ spring: bouncy, toScale: 0.95 })

  return (
    <Pressable
      onPress={onSelect}
      onPressIn={(e) => {
        driver.onPressIn()
        callerIn?.(e)
      }}
      onPressOut={(e) => {
        driver.onPressOut()
        callerOut?.(e)
      }}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      style={styles.optPressable}
    >
      <Animated.View
        style={[
          styles.optBase,
          selected
            ? {
                backgroundColor: OPT_BG[opt.key],
                borderColor: OPT_BORDER[opt.key],
                ...SELECTED_SHADOW,
              }
            : styles.optUnselected,
          driver.animatedStyle,
        ]}
      >
        <Text style={styles.optFace}>{opt.face}</Text>
        <Text style={styles.optLabel}>{label || opt.label}</Text>
      </Animated.View>
    </Pressable>
  )
}

/**
 * VerdictPicker — tap yum / meh / nah. Controlled via `value` + `onChange`.
 */
export function VerdictPicker({ value, onChange, labels, style, ...rest }: VerdictPickerProps) {
  return (
    <View style={[styles.row, style]} {...rest}>
      {OPTS.map((o) => (
        <OptItem
          key={o.key}
          opt={o}
          selected={value === o.key}
          onSelect={() => onChange?.(o.key)}
          label={labels?.[o.key]}
        />
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: space[3],
  },
  optPressable: {
    flex: 1,
  },
  optBase: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: space[4],
    borderWidth: 3,
    borderColor: colors.ink900,
    borderRadius: radius.md,
    // flat (unselected) shadow off
    shadowColor: colors.ink900,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    shadowRadius: 0,
  },
  optUnselected: {
    backgroundColor: colors.white,
    borderColor: colors.ink900,
  },
  optFace: {
    color: colors.ink900,
    fontSize: 28,
    lineHeight: 32,
  },
  optLabel: {
    color: colors.ink900,
    fontWeight: '700',
    fontSize: 16,
    letterSpacing: 1,
  },
})

export default VerdictPicker
