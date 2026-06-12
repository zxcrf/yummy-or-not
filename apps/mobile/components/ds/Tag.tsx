/* ============================================================
   YUMMY OR NOT — Tag (plain RN + StyleSheet)
   Rounded pixel chip. Clickable (filter) and/or removable.
   Press motion: usePressScale(quick) 0.92 + opacity 0.85.
   §1.3b event-composition contract enforced:
     - caller onPressIn/onPressOut always forwarded
     - disabled suppresses animation + sets accessibilityState
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
} from 'react-native'
import Animated from 'react-native-reanimated'
import { colors, radius, space, quick, usePressScale } from '@/theme'

export interface TagProps extends Omit<PressableProps, 'children' | 'style'> {
  /** Highlighted (selected filter) state. */
  active?: boolean
  /** Called when the × is pressed. Renders a remove affordance. */
  onRemove?: () => void
  onPress?: () => void
  onPressIn?: PressableProps['onPressIn']
  onPressOut?: PressableProps['onPressOut']
  /** Disabled state — suppresses press animation + sets accessibilityState. */
  disabled?: boolean
  /** Style pass-through reaches the animated wrapper (e.g. position:'absolute'). */
  style?: StyleProp<ViewStyle>
  children?: React.ReactNode
}

/**
 * Tag — rounded chip. Clickable (filter) and/or removable.
 * Press motion: usePressScale(quick) → scale 0.92 + opacity 0.85.
 */
export function Tag({
  active = false,
  onRemove,
  onPress,
  onPressIn: callerPressIn,
  onPressOut: callerPressOut,
  disabled = false,
  style,
  children,
  ...rest
}: TagProps) {
  const clickable = !!onPress && !disabled

  const driver = usePressScale(
    { spring: quick, toScale: 0.92, toOpacity: 0.85 },
    disabled,
  )

  const textColor = active ? colors.onBrand : colors.ink900

  if (!onPress) {
    // Static (non-interactive) chip — plain View, no Pressable overhead.
    // Forward safe View-compatible rest props (testID, a11y, hitSlop, etc.)
    // by picking the subset that doesn't conflict with our fixed styles.
    const { testID, accessibilityLabel, accessibilityHint, accessibilityRole } = rest as {
      testID?: string
      accessibilityLabel?: string
      accessibilityHint?: string
      accessibilityRole?: string
    }
    return (
      <View
        style={[styles.chip, active && styles.active, style]}
        testID={testID}
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
        accessibilityRole={accessibilityRole as React.ComponentProps<typeof View>['accessibilityRole']}
      >
        <Text style={[styles.label, { color: textColor }]}>{children}</Text>
        {onRemove ? (
          <Text
            accessibilityRole="button"
            accessibilityLabel="Remove"
            onPress={(e) => {
              e.stopPropagation?.()
              onRemove()
            }}
            style={[styles.remove, { color: textColor }]}
          >
            ×
          </Text>
        ) : null}
      </View>
    )
  }

  return (
    <Pressable
      onPress={onPress}
      onPressIn={(e) => {
        driver.onPressIn()
        callerPressIn?.(e)
      }}
      onPressOut={(e) => {
        driver.onPressOut()
        callerPressOut?.(e)
      }}
      disabled={disabled}
      accessibilityRole="button"
      {...rest}
      accessibilityState={{ ...(rest as { accessibilityState?: object }).accessibilityState, disabled }}
    >
      <Animated.View
        style={[styles.chip, active && styles.active, style, driver.animatedStyle]}
      >
        <Text style={[styles.label, { color: textColor }]}>{children}</Text>
        {onRemove && !disabled ? (
          <Text
            accessibilityRole="button"
            accessibilityLabel="Remove"
            onPress={(e) => {
              e.stopPropagation?.()
              onRemove()
            }}
            style={[styles.remove, { color: textColor }]}
          >
            ×
          </Text>
        ) : null}
      </Animated.View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingHorizontal: space[3],
    paddingVertical: space[1],
    borderWidth: 2,
    borderColor: colors.ink900,
    borderRadius: radius.pill,
    backgroundColor: colors.paper2,
  },
  active: {
    backgroundColor: colors.brand,
    borderColor: colors.ink900,
  },
  label: {
    fontWeight: '600',
    fontSize: 13,
    lineHeight: 17,
    color: colors.ink900,
  },
  remove: {
    fontWeight: '700',
    fontSize: 14,
    lineHeight: 17,
    color: colors.ink900,
  },
})

export default Tag
