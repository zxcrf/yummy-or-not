/* ============================================================
   YUMMY OR NOT — VerdictStamp (Tamagui / React Native)
   The slap-on verdict label (yum / meh / nah). Ported from the web DS:
   a chunky bordered pill in the verdict color with a kaomoji face and
   the verdict word. Verdict token colors come from tamagui.config.ts.
   ============================================================ */

import { type GetProps, View, styled, Text } from 'tamagui'
import type { Verdict } from '@yon/shared'

const FACES: Record<Verdict, string> = { yum: '◕‿◕', meh: '•_•', nah: '×_×' }
const LABELS: Record<Verdict, string> = { yum: 'YUM', meh: 'MEH', nah: 'NAH' }

const StampFrame = styled(View, {
  name: 'VerdictStamp',
  flexDirection: 'row',
  alignItems: 'center',
  alignSelf: 'flex-start',
  borderWidth: 3,
  borderColor: '$ink900',
  borderRadius: '$sm',
  backgroundColor: '$verdictYum',

  variants: {
    verdict: {
      yum: { backgroundColor: '$verdictYum', borderColor: '$verdictYum2' },
      meh: { backgroundColor: '$verdictMeh', borderColor: '$verdictMeh2' },
      nah: { backgroundColor: '$verdictNah', borderColor: '$verdictNah2' },
    },
    size: {
      sm: { paddingHorizontal: '$2', paddingVertical: '$1', gap: 4 },
      md: { paddingHorizontal: '$3', paddingVertical: '$2', gap: 6 },
      lg: { paddingHorizontal: '$4', paddingVertical: '$3', gap: 8 },
    },
  } as const,

  defaultVariants: {
    verdict: 'yum',
    size: 'md',
  },
})

const SIZE_FONT = { sm: 11, md: 14, lg: 18 } as const

export type VerdictStampProps = Omit<GetProps<typeof StampFrame>, 'verdict' | 'size' | 'rotate'> & {
  verdict?: Verdict
  size?: 'sm' | 'md' | 'lg'
  /** Override the verdict word text. */
  label?: string
  /** Rotation in degrees; 0 = upright. */
  rotate?: number
  showFace?: boolean
}

/**
 * VerdictStamp — the slap-on verdict label (yum / meh / nah).
 */
export function VerdictStamp({
  verdict = 'yum',
  size = 'md',
  showFace = true,
  rotate = 0,
  label,
  ...rest
}: VerdictStampProps) {
  const fontSize = SIZE_FONT[size]

  return (
    <StampFrame
      verdict={verdict}
      size={size}
      rotate={rotate ? `${rotate}deg` : undefined}
      {...rest}
    >
      {showFace ? (
        <Text color="$ink900" fontSize={fontSize} lineHeight={fontSize + 2}>
          {FACES[verdict]}
        </Text>
      ) : null}
      <Text
        color="$ink900"
        fontWeight="700"
        fontSize={fontSize}
        lineHeight={fontSize + 2}
        letterSpacing={1}
      >
        {label || LABELS[verdict]}
      </Text>
    </StampFrame>
  )
}

export default VerdictStamp
