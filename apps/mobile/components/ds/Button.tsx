/* ============================================================
   YUMMY OR NOT — Button (plain RN + Reanimated)
   Pressable → Animated.View frame with usePressNudge(bouncy).
   Five variants × three sizes. §1.3b event-composition contract.
   ============================================================ */

import React from 'react'
import {
  Pressable,
  Text,
  StyleSheet,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native'
import Animated from 'react-native-reanimated'
import { colors, radius, space, popShadow, bouncy, usePressNudge } from '@/theme'

// ---------- Public types ----------

export type ButtonVariant = 'primary' | 'secondary' | 'accent' | 'dark' | 'ghost'
export type ButtonSize = 'sm' | 'md' | 'lg'

export type ButtonProps = Omit<PressableProps, 'style' | 'children'> & {
  /** Visual style. */
  variant?: ButtonVariant
  /** Control size. */
  size?: ButtonSize
  /** Stretch to full width. */
  block?: boolean
  /** Disabled — suppresses press animation AND sets accessibilityState.disabled */
  disabled?: boolean
  /** Element rendered before the label (e.g. an <Icon/>). */
  iconLeft?: React.ReactNode
  /** Element rendered after the label. */
  iconRight?: React.ReactNode
  children?: React.ReactNode
  /** Pass-through style applied to the Animated.View frame. */
  style?: StyleProp<ViewStyle>
}

// ---------- Style maps ----------

const LABEL_COLOR: Record<ButtonVariant, string> = {
  primary: colors.onBrand,
  secondary: colors.ink900,
  accent: colors.ink900,
  dark: colors.paper,
  ghost: colors.ink900,
}

const LABEL_FONT: Record<ButtonSize, number> = { sm: 14, md: 16, lg: 18 }

const styles = StyleSheet.create({
  // base frame — shared by all variants/sizes
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
    gap: space[2],
    borderWidth: 3,
    borderColor: colors.ink900,
    borderRadius: radius.md,
    // pop-shadow (iOS; Android = translate only per material-motion.md)
    ...popShadow.sm,
  },
  // --- variant backgrounds ---
  primary: { backgroundColor: colors.brand },
  secondary: { backgroundColor: colors.white },
  accent: { backgroundColor: colors.candyYellow },
  dark: { backgroundColor: colors.ink900 },
  ghost: {
    backgroundColor: 'transparent',
    borderColor: 'transparent',
    shadowOpacity: 0,
  },
  // --- sizes ---
  sm: { paddingHorizontal: space[3], paddingVertical: 7, borderRadius: radius.sm },
  md: { paddingHorizontal: 18, paddingVertical: 11 },
  lg: { paddingHorizontal: 26, paddingVertical: 15, borderRadius: radius.lg },
  // --- block ---
  block: { alignSelf: 'stretch', width: '100%' },
  // --- disabled ---
  disabled: { opacity: 0.45 },
})

// ---------- Component ----------

/**
 * Button — primary action control. Chunky border + pop-shadow that
 * nudges into the page on press (usePressNudge, bouncy spring).
 * Follows §1.3b event-composition contract.
 */
export function Button({
  variant = 'primary',
  size = 'md',
  block = false,
  disabled = false,
  iconLeft,
  iconRight,
  children,
  style,
  onPressIn: callerPressIn,
  onPressOut: callerPressOut,
  ...rest
}: ButtonProps) {
  const driver = usePressNudge({ spring: bouncy }, disabled)

  const frameStyle = [
    styles.base,
    styles[variant],
    styles[size],
    block && styles.block,
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
        {iconLeft}
        {typeof children === 'string' || typeof children === 'number' ? (
          <Text
            style={{
              color: LABEL_COLOR[variant],
              fontWeight: '700',
              fontSize: LABEL_FONT[size],
            }}
          >
            {children}
          </Text>
        ) : (
          children
        )}
        {iconRight}
      </Animated.View>
    </Pressable>
  )
}

export default Button
