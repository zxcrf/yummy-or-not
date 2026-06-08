/* ============================================================
   YUMMY OR NOT — Textarea (Tamagui / React Native)
   Multi-line text field with optional uppercase pixel label and
   hint. Ported from the web DS: chunky ink border, hard blue focus
   shadow; error state turns the border red. Wraps Tamagui TextArea.
   ============================================================ */

import { type GetProps, styled, TextArea as TTextArea, Text, View } from 'tamagui'

const Field = styled(TTextArea, {
  name: 'Textarea',
  fontSize: 16,
  color: '$ink900',
  backgroundColor: '$white',
  borderWidth: 3,
  borderColor: '$ink900',
  borderRadius: '$sm',
  paddingHorizontal: 13,
  paddingVertical: 11,
  width: '100%',
  minHeight: 88,
  placeholderTextColor: '$ink400',
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

export type TextareaProps = Omit<GetProps<typeof Field>, 'error'> & {
  /** Uppercase pixel label above the field. */
  label?: string
  /** Helper text below the field. */
  hint?: string
  /** Error message (replaces hint and turns the field red). */
  error?: string
}

/**
 * Textarea — multi-line text field with optional label and hint.
 */
export function Textarea({ label, hint, error, ...rest }: TextareaProps) {
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

export default Textarea
