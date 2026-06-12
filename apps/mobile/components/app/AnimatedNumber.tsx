/* ============================================================
   AnimatedNumber — rolls a number from its previous value to the new
   target over ~700 ms with an ease-out curve.

   Uses react-native-reanimated:
   - useSharedValue + withTiming drives the animation on the UI thread.
   - prepare() rounds to the display precision (worklet, numeric only).
   - react() calls runOnJS(onDisplay) with the raw rounded NUMBER — zero
     string operations inside either worklet function.
   - onDisplay (useCallback, JS thread) does all toFixed/String formatting.

   Currency: the SYMBOL must live outside this component. Pass only the
   numeric value; render the symbol as a static sibling.
   ============================================================ */

import { useCallback, useEffect, useState } from 'react'
import Animated from 'react-native-reanimated'
import { textBase } from '@/theme'
import {
  useSharedValue,
  useAnimatedReaction,
  useReducedMotion,
  withTiming,
  Easing,
  runOnJS,
} from 'react-native-reanimated'

const DURATION = 700

export interface AnimatedNumberProps {
  /** Numeric target to animate to. */
  value: number
  /**
   * Decimal places to display. 0 = integer counts (default).
   * Pass 2 for money values.
   */
  decimals?: number
  [prop: string]: unknown
}

export default function AnimatedNumber({
  value,
  decimals = 0,
  testID,
  ...textProps
}: AnimatedNumberProps & { testID?: string }) {
  const reducedMotion = useReducedMotion()
  const shared = useSharedValue(0)
  const [display, setDisplay] = useState('0')

  // onDisplay runs on the JS thread (via runOnJS). All string formatting lives
  // here — toFixed and String() are never called inside a worklet.
  const onDisplay = useCallback(
    (rounded: number) => {
      setDisplay(decimals > 0 ? rounded.toFixed(decimals) : String(Math.round(rounded)))
    },
    [decimals],
  )

  useEffect(() => {
    if (reducedMotion) {
      shared.value = value
    } else {
      shared.value = withTiming(value, {
        duration: DURATION,
        easing: Easing.out(Easing.cubic),
      })
    }
  }, [value, reducedMotion, shared])

  useAnimatedReaction(
    // prepare: worklet — returns a rounded NUMBER only, no string ops.
    () => {
      'worklet'
      const factor = decimals > 0 ? Math.pow(10, decimals) : 1
      return Math.round(shared.value * factor) / factor
    },
    // react: worklet — bridges to JS only when the rounded value changes.
    (rounded, previous) => {
      'worklet'
      if (rounded !== previous) {
        runOnJS(onDisplay)(rounded)
      }
    },
    [decimals, onDisplay],
  )

  return <Animated.Text testID={testID} style={[textBase, (textProps as { style?: object }).style]}>{display}</Animated.Text>
}
