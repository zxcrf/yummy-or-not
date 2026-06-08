/* ============================================================
   YUMMY OR NOT — IconButton (Tamagui / React Native)
   A square (or round) button holding one Icon. Ported from the web
   DS: chunky ink border + hard offset pop-shadow, presses in on
   press. Three sizes × three variants.
   ============================================================ */

import { type GetProps, styled, View } from 'tamagui'

const Frame = styled(View, {
  name: 'IconButton',
  alignItems: 'center',
  justifyContent: 'center',
  alignSelf: 'flex-start',
  borderWidth: 3,
  borderColor: '$ink900',
  borderRadius: '$md',
  backgroundColor: '$white',
  cursor: 'pointer',
  shadowColor: '$ink900',
  shadowOffset: { width: 3, height: 3 },
  shadowOpacity: 1,
  shadowRadius: 0,
  pressStyle: {
    x: 3,
    y: 3,
    shadowOffset: { width: 0, height: 0 },
  },

  variants: {
    variant: {
      secondary: { backgroundColor: '$white' },
      pink: { backgroundColor: '$brand' },
      accent: { backgroundColor: '$candyYellow' },
    },
    size: {
      sm: { width: 34, height: 34, borderRadius: '$sm' },
      md: { width: 42, height: 42 },
      lg: { width: 52, height: 52 },
    },
    round: {
      true: { borderRadius: '$pill' },
    },
    disabled: {
      true: { opacity: 0.45, cursor: 'not-allowed', pressStyle: { x: 0, y: 0 } },
    },
  } as const,

  defaultVariants: {
    variant: 'secondary',
    size: 'md',
  },
})

export type IconButtonVariant = 'secondary' | 'pink' | 'accent'
export type IconButtonSize = 'sm' | 'md' | 'lg'

export type IconButtonProps = Omit<GetProps<typeof Frame>, 'variant' | 'size'> & {
  /** Visual style. */
  variant?: IconButtonVariant
  /** Control size. */
  size?: IconButtonSize
  /** Fully rounded instead of squared. */
  round?: boolean
  children?: React.ReactNode
}

/** A square/round button holding one Icon. */
export function IconButton({
  variant = 'secondary',
  size = 'md',
  round = false,
  disabled = false,
  children,
  ...rest
}: IconButtonProps) {
  return (
    <Frame
      variant={variant}
      size={size}
      round={round}
      disabled={disabled}
      accessibilityRole="button"
      {...rest}
    >
      {children}
    </Frame>
  )
}

export default IconButton
