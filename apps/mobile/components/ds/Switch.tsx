/* ============================================================
   YUMMY OR NOT — Switch (Tamagui / React Native)
   Pixel toggle switch; verdict-green when on. Ported from the web
   DS: a chunky ink-bordered pill track (56×30) with a round knob
   that slides 1 → 27px. Controlled via `checked` + `onChange`.
   ============================================================ */

import { useEffect } from 'react'
import { type GetProps, styled, View } from 'tamagui'
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated'

const KNOB_OFF = 1
const KNOB_ON = 27
const SPRING = { damping: 15, stiffness: 200 }

const Track = styled(View, {
  name: 'Switch',
  position: 'relative',
  width: 56,
  height: 30,
  flexShrink: 0,
  borderWidth: 3,
  borderColor: '$ink900',
  borderRadius: '$pill',
  backgroundColor: '$ink200',
  cursor: 'pointer',

  variants: {
    checked: {
      true: { backgroundColor: '$verdictYum' },
    },
    disabled: {
      true: { opacity: 0.45, cursor: 'not-allowed' },
    },
  } as const,
})

export type SwitchProps = Omit<GetProps<typeof Track>, 'checked' | 'onChange'> & {
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
    <Track
      checked={checked}
      disabled={disabled}
      accessibilityRole="switch"
      aria-checked={checked}
      onPress={() => {
        if (!disabled) onChange?.(!checked)
      }}
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
    </Track>
  )
}

export default Switch
