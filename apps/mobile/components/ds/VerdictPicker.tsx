/* ============================================================
   YUMMY OR NOT — VerdictPicker (Tamagui / React Native)
   The core capture interaction: tap yum / meh / nah. Controlled via
   `value` + `onChange(key)`. Ported from the web DS — three big
   bordered buttons in the verdict colors; the selected one pops
   (filled + hard offset shadow), the rest sit flat on paper.
   ============================================================ */

import { type GetProps, View, styled, Text } from 'tamagui'
import { bouncy } from './animation'
import type { Verdict } from '@yon/shared'

const OPTS: { key: Verdict; face: string; label: string }[] = [
  { key: 'yum', face: '◕‿◕', label: 'YUM' },
  { key: 'meh', face: '•_•', label: 'MEH' },
  { key: 'nah', face: '×_×', label: 'NAH' },
]

// Selected fill + border per verdict, expressed as a styled variant so the
// token colors stay type-checked against tamagui.config.ts.
const Opt = styled(View, {
  name: 'VerdictPickerOpt',
  flex: 1,
  alignItems: 'center',
  justifyContent: 'center',
  gap: 4,
  paddingVertical: '$4',
  borderWidth: 3,
  borderColor: '$ink900',
  borderRadius: '$md',
  backgroundColor: '$white',
  cursor: 'pointer',
  pressStyle: {
    scale: 0.95,
  },
  shadowColor: '$ink900',
  shadowOffset: { width: 0, height: 0 },
  shadowOpacity: 0,
  shadowRadius: 0,

  variants: {
    selected: {
      yum: {
        backgroundColor: '$verdictYum',
        borderColor: '$verdictYum2',
        shadowOffset: { width: 4, height: 4 },
        shadowOpacity: 1,
      },
      meh: {
        backgroundColor: '$verdictMeh',
        borderColor: '$verdictMeh2',
        shadowOffset: { width: 4, height: 4 },
        shadowOpacity: 1,
      },
      nah: {
        backgroundColor: '$verdictNah',
        borderColor: '$verdictNah2',
        shadowOffset: { width: 4, height: 4 },
        shadowOpacity: 1,
      },
      none: {},
    },
  } as const,
})

export type VerdictPickerProps = Omit<GetProps<typeof View>, 'onChange'> & {
  /** Currently selected verdict. */
  value?: Verdict | null
  /** Called with the chosen verdict key. */
  onChange?: (verdict: Verdict) => void
  /** Override the display labels. */
  labels?: Partial<Record<Verdict, string>>
}

/**
 * VerdictPicker — tap yum / meh / nah. Controlled via `value` + `onChange`.
 */
export function VerdictPicker({ value, onChange, labels, ...rest }: VerdictPickerProps) {
  return (
    <View flexDirection="row" gap="$3" {...rest}>
      {OPTS.map((o) => {
        const on = value === o.key
        return (
          <Opt
            key={o.key}
            {...bouncy}
            selected={on ? o.key : 'none'}
            accessibilityRole="radio"
            aria-checked={on}
            onPress={() => onChange?.(o.key)}
          >
            <Text color="$ink900" fontSize={28} lineHeight={32}>
              {o.face}
            </Text>
            <Text color="$ink900" fontWeight="700" fontSize={16} letterSpacing={1}>
              {labels?.[o.key] || o.label}
            </Text>
          </Opt>
        )
      })}
    </View>
  )
}

export default VerdictPicker
