/* ============================================================
   YUMMY OR NOT — Button (Tamagui / React Native)
   The primary action control. Ported from the web DS: a chunky
   ink-bordered button with a hard offset pop-shadow that presses
   into the page on :active. Five variants × three sizes.
   ============================================================ */

import { type GetProps, styled, Text, View } from 'tamagui'

const Frame = styled(View, {
  name: 'Button',
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'center',
  alignSelf: 'flex-start',
  gap: '$2',
  borderWidth: 3,
  borderColor: '$ink900',
  borderRadius: '$md',
  backgroundColor: '$brand',
  cursor: 'pointer',
  // hard pop-shadow (3px offset, no blur)
  shadowColor: '$ink900',
  shadowOffset: { width: 3, height: 3 },
  shadowOpacity: 1,
  shadowRadius: 0,
  // press nudges into the shadow
  pressStyle: {
    x: 3,
    y: 3,
    shadowOffset: { width: 0, height: 0 },
  },

  variants: {
    variant: {
      primary: { backgroundColor: '$brand' },
      secondary: { backgroundColor: '$white' },
      accent: { backgroundColor: '$candyYellow' },
      dark: { backgroundColor: '$ink900' },
      ghost: {
        backgroundColor: 'transparent',
        borderColor: 'transparent',
        shadowOpacity: 0,
        pressStyle: { backgroundColor: '$ink200', x: 0, y: 1 },
      },
    },
    size: {
      sm: { paddingHorizontal: '$3', paddingVertical: 7, borderRadius: '$sm' },
      md: { paddingHorizontal: 18, paddingVertical: 11 },
      lg: { paddingHorizontal: 26, paddingVertical: 15, borderRadius: '$lg' },
    },
    block: {
      true: { alignSelf: 'stretch', width: '100%' },
    },
    disabled: {
      true: { opacity: 0.45, cursor: 'not-allowed', pressStyle: { x: 0, y: 0 } },
    },
  } as const,

  defaultVariants: {
    variant: 'primary',
    size: 'md',
  },
})

const LABEL_COLOR = {
  primary: '$onBrand',
  secondary: '$ink900',
  accent: '$ink900',
  dark: '$paper',
  ghost: '$ink900',
} as const

const LABEL_FONT = { sm: 14, md: 16, lg: 18 } as const

export type ButtonVariant = 'primary' | 'secondary' | 'accent' | 'dark' | 'ghost'
export type ButtonSize = 'sm' | 'md' | 'lg'

export type ButtonProps = Omit<GetProps<typeof Frame>, 'variant' | 'size'> & {
  /** Visual style. */
  variant?: ButtonVariant
  /** Control size. */
  size?: ButtonSize
  /** Stretch to full width. */
  block?: boolean
  /** Element rendered before the label (e.g. an <Icon/>). */
  iconLeft?: React.ReactNode
  /** Element rendered after the label. */
  iconRight?: React.ReactNode
  children?: React.ReactNode
}

/**
 * Button — the primary action control. Chunky border + pop shadow that
 * presses into the page on press.
 */
export function Button({
  variant = 'primary',
  size = 'md',
  block = false,
  disabled = false,
  iconLeft,
  iconRight,
  children,
  ...rest
}: ButtonProps) {
  return (
    <Frame
      variant={variant}
      size={size}
      block={block}
      disabled={disabled}
      accessibilityRole="button"
      {...rest}
    >
      {iconLeft}
      {typeof children === 'string' || typeof children === 'number' ? (
        <Text color={LABEL_COLOR[variant]} fontWeight="700" fontSize={LABEL_FONT[size]}>
          {children}
        </Text>
      ) : (
        children
      )}
      {iconRight}
    </Frame>
  )
}

export default Button
