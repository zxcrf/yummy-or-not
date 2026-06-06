/* ============================================================
   YUMMY OR NOT — Badge (Tamagui / React Native)
   Tiny pixel status pill. Ported from the web DS: a thin (2px)
   ink-bordered rounded pill with an uppercase micro label. Six
   tones map to the candy / verdict palette.
   ============================================================ */

import { type GetProps, styled, Text, View } from 'tamagui'

const Pill = styled(View, {
  name: 'Badge',
  flexDirection: 'row',
  alignItems: 'center',
  alignSelf: 'flex-start',
  gap: 5,
  paddingHorizontal: 9,
  paddingVertical: 5,
  borderWidth: 2,
  borderColor: '$ink900',
  borderRadius: '$pill',
  backgroundColor: '$white',

  variants: {
    tone: {
      default: { backgroundColor: '$white' },
      yum: { backgroundColor: '$verdictYum' },
      meh: { backgroundColor: '$verdictMeh' },
      nah: { backgroundColor: '$verdictNah' },
      dark: { backgroundColor: '$ink900' },
      pink: { backgroundColor: '$brand' },
    },
  } as const,

  defaultVariants: {
    tone: 'default',
  },
})

export type BadgeTone = 'default' | 'yum' | 'meh' | 'nah' | 'dark' | 'pink'

const TONE_COLOR = {
  default: '$ink900',
  yum: '$onBrand',
  meh: '$ink900',
  nah: '$onBrand',
  dark: '$paper',
  pink: '$onBrand',
} as const satisfies Record<BadgeTone, string>

export type BadgeProps = Omit<GetProps<typeof Pill>, 'tone'> & {
  /** Color tone. */
  tone?: BadgeTone
  children?: React.ReactNode
}

/**
 * Badge — tiny pixel status pill.
 */
export function Badge({ tone = 'default', children, ...rest }: BadgeProps) {
  return (
    <Pill tone={tone} {...rest}>
      <Text
        color={TONE_COLOR[tone]}
        fontSize={10}
        letterSpacing={0.64}
        lineHeight={12}
        textTransform="uppercase"
      >
        {children}
      </Text>
    </Pill>
  )
}

export default Badge
