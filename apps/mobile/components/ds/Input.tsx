/* ============================================================
   YUMMY OR NOT — Input (Tamagui / React Native)
   Single-line text field with optional uppercase pixel label and
   hint. Ported from the web DS: chunky ink border, hard blue focus
   shadow; the error state turns the border red. Wraps Tamagui Input.
   ============================================================ */

import { Input as TInput, type GetProps, styled, Text, View } from 'tamagui'

const Field = styled(TInput, {
  name: 'Input',
  fontSize: 16,
  color: '$ink900',
  backgroundColor: '$white',
  borderWidth: 3,
  borderColor: '$ink900',
  borderRadius: '$sm',
  paddingHorizontal: 13,
  paddingVertical: 11,
  width: '100%',
  placeholderTextColor: '$ink400',
  // hard blue focus shadow
  focusStyle: {
    borderColor: '$ink900',
    shadowColor: '$candyBlue',
    shadowOffset: { width: 3, height: 3 },
    shadowOpacity: 1,
    shadowRadius: 0,
  },

  variants: {
    error: {
      true: {
        borderColor: '$verdictNah',
        focusStyle: {
          borderColor: '$verdictNah',
          shadowColor: '$verdictNah',
          shadowOffset: { width: 3, height: 3 },
          shadowOpacity: 1,
          shadowRadius: 0,
        },
      },
    },
  } as const,
})

export type InputProps = Omit<GetProps<typeof Field>, 'error'> & {
  /** Uppercase pixel label above the field. */
  label?: string
  /** Helper text below the field. */
  hint?: string
  /** Error message (replaces hint and turns the field red). */
  error?: string
}

/**
 * Input — single-line text field with optional label and hint.
 */
export function Input({ label, hint, error, ...rest }: InputProps) {
  return (
    <View gap={6} width="100%">
      {label ? (
        <Text
          color="$ink700"
          fontSize={11}
          letterSpacing={1.92}
          textTransform="uppercase"
        >
          {label}
        </Text>
      ) : null}
      <Field error={!!error} {...rest} />
      {error || hint ? (
        <Text fontSize={12} color={error ? '$verdictNah2' : '$ink500'}>
          {error || hint}
        </Text>
      ) : null}
    </View>
  )
}

export default Input
