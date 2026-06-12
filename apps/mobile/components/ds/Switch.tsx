/* ============================================================
   YUMMY OR NOT — Switch (React Native)
   Pixel toggle switch; verdict-green when on. Ported from the web
   DS: a chunky ink-bordered pill track (56×30) with a round knob
   that slides 1 → 27px. Controlled via `checked` + `onChange`.
   ============================================================ */

import { useEffect } from 'react'
import { Pressable, StyleSheet, type ViewProps } from 'react-native'
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated'
import { colors, radius } from '@/theme'

const KNOB_OFF = 1
const KNOB_ON = 27
const SPRING = { damping: 15, stiffness: 200 }

const styles = StyleSheet.create({
  track: {
    position: 'relative',
    width: 56,
    height: 30,
    flexShrink: 0,
    borderWidth: 3,
    borderColor: colors.ink900,
    borderRadius: radius.pill,
    backgroundColor: colors.ink200,
  },
  trackChecked: {
    backgroundColor: colors.verdictYum,
  },
  trackDisabled: {
    opacity: 0.45,
  },
})

export interface SwitchProps extends Omit<ViewProps, 'style'> {
  checked?: boolean
  onChange?: (next: boolean) => void
  disabled?: boolean
}

export function Switch({ checked = false, onChange, disabled = false, ...rest }: SwitchProps) {
  const knobX = useSharedValue(checked ? KNOB_ON : KNOB_OFF)

  useEffect(() => {
    knobX.value = withSpring(checked ? KNOB_ON : KNOB_OFF, SPRING)
  }, [checked, knobX])

  const knobStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: knobX.value }],
  }))

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked, disabled }}
      disabled={disabled}
      onPress={() => {
        if (!disabled) onChange?.(!checked)
      }}
      style={[
        styles.track,
        checked && styles.trackChecked,
        disabled && styles.trackDisabled,
      ]}
      {...rest}
    >
      <Animated.View
        style={[
          {
            position: 'absolute',
            top: 1,
            left: 0,
            width: 22,
            height: 22,
            backgroundColor: '#ffffff',
            borderWidth: 2,
            borderColor: '#191017',
            borderRadius: 999,
          },
          knobStyle,
        ]}
      />
    </Pressable>
  )
}

export default Switch
