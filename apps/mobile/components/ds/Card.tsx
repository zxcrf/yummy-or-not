/* ============================================================
   YUMMY OR NOT — Card (plain RN + Reanimated)
   The signature bordered + pop-shadow surface. Neo-brutalist:
   chunky ink border, hard offset shadow, clipped corners. The
   `interactive` variant pops on press via usePressNudge(quick).
   ============================================================ */

import React from 'react'
import {
  View,
  Pressable,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
  type PressableProps,
  type ViewProps,
} from 'react-native'
import Animated from 'react-native-reanimated'
import { colors, radius, space, popShadow, pressedShadow, quick } from '@/theme'
import { usePressNudge } from '@/theme/usePressMotion'

// ---------- Types ----------

export type CardVariant = 'raised' | 'flat' | 'soft'

export interface CardProps {
  /** Visual variant. */
  variant?: CardVariant
  /** Add standard internal padding. */
  padded?: boolean
  /** Show hover/press affordance. */
  interactive?: boolean
  /** Optional extra style (e.g. marginTop, maxWidth from callsites). */
  style?: StyleProp<ViewStyle>
  children?: React.ReactNode
  /** Forward any remaining ViewProps / PressableProps to the root node. */
  [key: string]: unknown
}

// ---------- Styles ----------

const styles = StyleSheet.create({
  base: {
    backgroundColor: colors.backgroundStrong, // #ffffff
    borderWidth: 3,
    borderColor: colors.ink900,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  // variant: raised — default pop-shadow 5x5
  raised: {
    ...popShadow.md, // shadowOffset:{5,5}, opacity:1, radius:0
  },
  // variant: flat — smaller pop-shadow 3x3
  flat: {
    ...popShadow.sm, // shadowOffset:{3,3}, opacity:1, radius:0
  },
  // variant: soft — ambient shadow
  soft: {
    shadowColor: colors.ink900,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.16,
    shadowRadius: 24,
  },
  // padded
  padded: {
    padding: space[5], // 20px — matches Tamagui '$5'
  },
})

// ---------- InteractiveCard (Pressable + Animated.View) ----------

interface InteractiveCardProps {
  variant: CardVariant
  padded: boolean
  style?: StyleProp<ViewStyle>
  children?: React.ReactNode
  rest: Record<string, unknown>
}

function InteractiveCard({ variant, padded, style, children, rest }: InteractiveCardProps) {
  const { onPressIn: driverIn, onPressOut: driverOut, animatedStyle } = usePressNudge(
    { spring: quick, nudgeX: 2, nudgeY: 2 },
  )

  // Extract Pressable-specific props from rest
  const {
    onPress,
    onPressIn: callerIn,
    onPressOut: callerOut,
    onLongPress,
    testID,
    accessibilityLabel,
    accessibilityHint,
    accessibilityRole,
    hitSlop,
    disabled,
    ...viewRest
  } = rest as PressableProps & Record<string, unknown>

  // Pressed shadow style: 5x5 → 3x3 (iOS only; Android uses translate)
  // We derive from whether the animation is active by tracking press state.
  // For Card, spec says shadow 5x5 → 3x3 on press. We apply pressedShadow.card
  // via a pressed render-prop on the Pressable.

  return (
    <Pressable
      onPress={onPress as PressableProps['onPress']}
      onPressIn={(e) => {
        driverIn()
        ;(callerIn as PressableProps['onPressIn'])?.(e)
      }}
      onPressOut={(e) => {
        driverOut()
        ;(callerOut as PressableProps['onPressOut'])?.(e)
      }}
      onLongPress={onLongPress as PressableProps['onLongPress']}
      testID={testID as string | undefined}
      accessibilityLabel={accessibilityLabel as string | undefined}
      accessibilityHint={accessibilityHint as string | undefined}
      accessibilityRole={(accessibilityRole ?? 'button') as PressableProps['accessibilityRole']}
      hitSlop={hitSlop as PressableProps['hitSlop']}
      disabled={disabled as boolean | undefined}
      accessibilityState={{ disabled: !!disabled }}
    >
      {({ pressed }) => (
        <Animated.View
          style={[
            styles.base,
            styles[variant],
            padded && styles.padded,
            // On press: shadow collapses from 5x5 to 3x3 (iOS); translate handles Android
            pressed ? pressedShadow.card : undefined,
            // Caller style before animated style so Reanimated transform wins.
            style,
            animatedStyle,
          ]}
          {...(viewRest as object)}
        >
          {children}
        </Animated.View>
      )}
    </Pressable>
  )
}

// ---------- Card ----------

/**
 * Card — the signature bordered + pop-shadow surface.
 *
 * Props:
 *   variant?: 'raised' | 'flat' | 'soft'   (default: 'raised')
 *   padded?:  boolean                        (default: false)
 *   interactive?: boolean                    (default: false)
 *   style?:   StyleProp<ViewStyle>           (marginTop, maxWidth, etc.)
 *   ...rest   forwarded to root View/Pressable
 */
export function Card({
  variant = 'raised',
  padded = false,
  interactive = false,
  style,
  children,
  ...rest
}: CardProps) {
  if (interactive) {
    return (
      <InteractiveCard
        variant={variant}
        padded={padded}
        style={style}
        rest={rest}
      >
        {children}
      </InteractiveCard>
    )
  }

  // Non-interactive: plain View
  const { testID, accessibilityLabel, ...viewRest } = rest as ViewProps & Record<string, unknown>
  return (
    <View
      style={[
        styles.base,
        styles[variant],
        padded && styles.padded,
        style,
      ]}
      testID={testID as string | undefined}
      accessibilityLabel={accessibilityLabel as string | undefined}
      {...(viewRest as object)}
    >
      {children}
    </View>
  )
}

export default Card
