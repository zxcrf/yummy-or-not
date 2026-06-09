/* ============================================================
   YUMMY OR NOT — Card (Tamagui / React Native)
   The signature bordered + pop-shadow surface. Ported from the web
   DS: chunky ink border, hard offset shadow, clipped corners. The
   `interactive` variant pops on press.
   ============================================================ */

import { type GetProps, styled, View } from 'tamagui'
import { quick } from './animation'

const Frame = styled(View, {
  name: 'Card',
  backgroundColor: '$backgroundStrong',
  borderWidth: 3,
  borderColor: '$ink900',
  borderRadius: '$lg',
  overflow: 'hidden',
  // default = "raised": shadow-pop (5px)
  shadowColor: '$ink900',
  shadowOffset: { width: 5, height: 5 },
  shadowOpacity: 1,
  shadowRadius: 0,

  variants: {
    variant: {
      raised: {
        shadowOffset: { width: 5, height: 5 },
        shadowOpacity: 1,
      },
      flat: {
        // shadow-pop-sm (3px)
        shadowOffset: { width: 3, height: 3 },
        shadowOpacity: 1,
      },
      soft: {
        // soft ambient shadow
        shadowOffset: { width: 0, height: 8 },
        shadowRadius: 24,
        shadowOpacity: 0.16,
      },
    },
    padded: {
      true: { padding: '$5' },
    },
    interactive: {
      true: {
        cursor: 'pointer',
        pressStyle: {
          x: 2,
          y: 2,
          shadowOffset: { width: 3, height: 3 },
        },
      },
    },
  } as const,

  defaultVariants: {
    variant: 'raised',
  },
})

export type CardVariant = 'raised' | 'flat' | 'soft'

export type CardProps = Omit<GetProps<typeof Frame>, 'variant'> & {
  /** Visual variant. */
  variant?: CardVariant
  /** Add standard internal padding. */
  padded?: boolean
  /** Show hover/press affordance. */
  interactive?: boolean
  children?: React.ReactNode
}

/**
 * Card — the signature bordered + pop-shadow surface.
 */
export function Card({
  variant = 'raised',
  padded = false,
  interactive = false,
  children,
  ...rest
}: CardProps) {
  return (
    <Frame {...(interactive ? quick : {})} variant={variant} padded={padded} interactive={interactive} {...rest}>
      {children}
    </Frame>
  )
}

export default Card
