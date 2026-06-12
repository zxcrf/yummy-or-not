/* ============================================================
   YUMMY OR NOT — IconButton (plain RN + Reanimated)
   A square (or round) button holding one Icon.
   Pressable → Animated.View with usePressNudge(bouncy).
   §1.3b event-composition contract.
   ============================================================ */

import React from 'react'
import {
  Pressable,
  StyleSheet,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native'
import Animated from 'react-native-reanimated'
import { colors, radius, popShadow, bouncy, usePressNudge } from '@/theme'

// ---------- Public types ----------

export type IconButtonVariant = 'secondary' | 'pink' | 'accent'
export type IconButtonSize = 'sm' | 'md' | 'lg'

export type IconButtonProps = Omit<PressableProps, 'style' | 'children'> & {
  /** Visual style. */
  variant?: IconButtonVariant
  /** Control size. */
  size?: IconButtonSize
  /** Fully rounded instead of squared. */
  round?: boolean
  /** Disabled — suppresses press animation AND sets accessibilityState.disabled */
  disabled?: boolean
  children?: React.ReactNode
  /** Pass-through style applied to the Animated.View frame. */
  style?: StyleProp<ViewStyle>
}

// ---------- Styles ----------

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
    borderWidth: 3,
    borderColor: colors.ink900,
    borderRadius: radius.md,
    // pop-shadow (iOS; Android = translate only per material-motion.md)
    ...popShadow.sm,
  },
  // --- variants ---
  secondary: { backgroundColor: colors.white },
  pink: { backgroundColor: colors.brand },
  accent: { backgroundColor: colors.candyYellow },
  // --- sizes ---
  sm: { width: 34, height: 34, borderRadius: radius.sm },
  md: { width: 42, height: 42 },
  lg: { width: 52, height: 52 },
  // --- round ---
  round: { borderRadius: radius.pill },
  // --- disabled ---
  disabled: { opacity: 0.45 },
})

// ---------- Component ----------

/** A square/round button holding one Icon. */
export function IconButton({
  variant = 'secondary',
  size = 'md',
  round = false,
  disabled = false,
  children,
  style,
  onPressIn: callerPressIn,
  onPressOut: callerPressOut,
  ...rest
}: IconButtonProps) {
  const driver = usePressNudge({ spring: bouncy }, disabled)

  const frameStyle = [
    styles.base,
    styles[variant],
    styles[size],
    round && styles.round,
    disabled && styles.disabled,
    driver.animatedStyle,
    style,
  ]

  return (
    <Pressable
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      onPressIn={(e) => {
        driver.onPressIn()
        callerPressIn?.(e)
      }}
      onPressOut={(e) => {
        driver.onPressOut()
        callerPressOut?.(e)
      }}
      {...rest}
    >
      <Animated.View style={frameStyle}>
        {children}
      </Animated.View>
    </Pressable>
  )
}

export default IconButton
