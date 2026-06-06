/* ============================================================
   YUMMY OR NOT — Switch (Tamagui / React Native)
   Pixel toggle switch; verdict-green when on. Ported from the web
   DS: a chunky ink-bordered pill track (56×30) with a round knob
   that slides 1 → 27px. Controlled via `checked` + `onChange`.
   ============================================================ */

import { type GetProps, styled, View } from 'tamagui'

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

const Knob = styled(View, {
  name: 'SwitchKnob',
  position: 'absolute',
  top: 1,
  width: 22,
  height: 22,
  backgroundColor: '$white',
  borderWidth: 2,
  borderColor: '$ink900',
  borderRadius: '$pill',

  variants: {
    checked: {
      true: { left: 27 },
      false: { left: 1 },
    },
  } as const,
})

export type SwitchProps = Omit<GetProps<typeof Track>, 'checked' | 'onChange'> & {
  /** On/off state (controlled). */
  checked?: boolean
  /** Called with the next boolean when toggled. */
  onChange?: (next: boolean) => void
  disabled?: boolean
}

/** Pixel toggle switch; green when on. */
export function Switch({ checked = false, onChange, disabled = false, ...rest }: SwitchProps) {
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
      <Knob checked={checked} />
    </Track>
  )
}

export default Switch
