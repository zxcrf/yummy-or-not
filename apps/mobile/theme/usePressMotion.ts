/* ============================================================
   YON — Reanimated press hooks.
   Implements the §1.3b event-composition contract:
     1. Caller onPressIn/onPressOut are always forwarded.
     2. disabled suppresses animation AND must be reflected in
        accessibilityState by the consuming component.
     3. hitSlop passes through via ...rest on the Pressable.
   ============================================================ */

import { useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated'
import type { WithSpringConfig } from 'react-native-reanimated'
import { quick } from './motion'

// ---------- Types ----------

export interface PressMotionConfig {
  /** Reanimated spring config (defaults to `quick`) */
  spring?: WithSpringConfig
}

export interface PressScaleConfig extends PressMotionConfig {
  /** Scale to animate to on press (default 0.92) */
  toScale?: number
  /** Opacity to animate to on press (default: no opacity animation) */
  toOpacity?: number
}

export interface PressNudgeConfig extends PressMotionConfig {
  /** translateX on press in pixels (default 3) */
  nudgeX?: number
  /** translateY on press in pixels (default 3) */
  nudgeY?: number
}

export interface PressMotionResult {
  animatedStyle: ReturnType<typeof useAnimatedStyle>
  /** Call this inside the Pressable's onPressIn — always compose with caller handler */
  onPressIn: () => void
  /** Call this inside the Pressable's onPressOut — always compose with caller handler */
  onPressOut: () => void
}

// ---------- usePressScale ----------
// Used by: Tag (0.92 + 0.85 opacity), VerdictPicker (0.95), FoodCard (0.98),
//          LangSwitcher trigger (0.95 + 0.85 opacity), AuthScreen MethodTab (0.95 + 0.8).

export function usePressScale(
  config: PressScaleConfig = {},
  disabled = false,
): PressMotionResult {
  const { spring = quick, toScale = 0.92, toOpacity } = config

  const scale = useSharedValue(1)
  const opacity = useSharedValue(1)

  const animatedStyle = useAnimatedStyle(() => {
    const style: Record<string, unknown> = {
      transform: [{ scale: scale.value }],
    }
    if (toOpacity !== undefined) {
      style.opacity = opacity.value
    }
    return style
  })

  const onPressIn = () => {
    if (disabled) return
    scale.value = withSpring(toScale, spring)
    if (toOpacity !== undefined) {
      opacity.value = withSpring(toOpacity, spring)
    }
  }

  const onPressOut = () => {
    if (disabled) return
    scale.value = withSpring(1, spring)
    if (toOpacity !== undefined) {
      opacity.value = withSpring(1, spring)
    }
  }

  return { animatedStyle, onPressIn, onPressOut }
}

// ---------- usePressNudge ----------
// Used by: Button / IconButton (nudge x:3 y:3, bouncy),
//          Card interactive (nudge x:2 y:2, quick).
//
// Drives translateX + translateY shared values.
// shadowOffset collapse is handled by the component itself using pressedShadow
// from @/theme/shadows (iOS only; Android gets translate only — per material-motion.md).

export function usePressNudge(
  config: PressNudgeConfig = {},
  disabled = false,
): PressMotionResult {
  const { spring = quick, nudgeX = 3, nudgeY = 3 } = config

  const translateX = useSharedValue(0)
  const translateY = useSharedValue(0)

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
    ],
  }))

  const onPressIn = () => {
    if (disabled) return
    translateX.value = withSpring(nudgeX, spring)
    translateY.value = withSpring(nudgeY, spring)
  }

  const onPressOut = () => {
    if (disabled) return
    translateX.value = withSpring(0, spring)
    translateY.value = withSpring(0, spring)
  }

  return { animatedStyle, onPressIn, onPressOut }
}
