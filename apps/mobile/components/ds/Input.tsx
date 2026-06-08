/* ============================================================
   YUMMY OR NOT — Input (Tamagui / React Native)
   Single-line text field with optional uppercase pixel label and
   hint. Ported from the web DS: chunky ink border, hard blue focus
   shadow; the error state turns the border red. Wraps Tamagui Input.
   ============================================================ */

import { Platform } from 'react-native'
import { Input as TInput, type GetProps, styled, Text, View } from 'tamagui'

// Exported for testing: '#191017' must be a concrete hex, not a Tamagui token ($ink900
// doesn't reach Android TextInput's text color — typed characters become invisible).
export const _FIELD_COLOR = '#191017' as const

const Field = styled(TInput, {
  name: 'Input',
  fontSize: 16,
  color: _FIELD_COLOR,
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
export function Input({ label, hint, error, secureTextEntry, ...rest }: InputProps) {
  const passwordProps =
    secureTextEntry && Platform.OS === 'web'
      ? ({ secureTextEntry: true, type: 'password' } as Record<string, unknown>)
      : { secureTextEntry }
  // Android: Tamagui styled() color doesn't reach TextInput.style.color — force it
  // via the style prop directly. includeFontPadding removes OS bottom padding that
  // pushes the cursor down in single-line fields.
  const androidStyle = Platform.OS === 'android'
    ? { style: { color: _FIELD_COLOR, textAlignVertical: 'center' as const }, includeFontPadding: false }
    : {}
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
      <Field error={!!error} {...passwordProps} {...rest} {...androidStyle} />
      {error || hint ? (
        <Text fontSize={12} color={error ? '$verdictNah2' : '$ink500'}>
          {error || hint}
        </Text>
      ) : null}
    </View>
  )
}

export default Input
