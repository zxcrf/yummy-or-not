/* ============================================================
   YUMMY OR NOT — Input (Tamagui / React Native)
   Single-line text field with optional uppercase pixel label and
   hint. Ported from the web DS: chunky ink border, hard blue focus
   shadow; the error state turns the border red. Wraps Tamagui Input.
   ============================================================ */

import { useState } from 'react'
import { Platform, TextInput as RNTextInput, type TextInputProps } from 'react-native'
import { Input as TInput, type GetProps, styled, Text, View } from 'tamagui'
import { quick } from './animation'

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
 * Android renders a raw RN TextInput instead of the Tamagui-styled `Field`:
 * Tamagui's styled(TextInput) does not forward the resolved text `color` to the
 * native input on release builds, so typed characters come out invisible (and
 * OS font padding misplaces the cursor). Plain RN style guarantees both. Web/iOS
 * keep `Field` for the hard pop-shadow focus look (Android elevation blurs it
 * anyway — see tamagui.config popShadow caveat — so focus is shown via border).
 */
function AndroidField({ error, ...props }: TextInputProps & { error?: boolean }) {
  const [focused, setFocused] = useState(false)
  return (
    <RNTextInput
      {...props}
      onFocus={(e) => {
        setFocused(true)
        props.onFocus?.(e)
      }}
      onBlur={(e) => {
        setFocused(false)
        props.onBlur?.(e)
      }}
      placeholderTextColor="#8f8189"
      selectionColor="#2f6bff"
      style={{
        fontSize: 16,
        color: _FIELD_COLOR,
        backgroundColor: '#ffffff',
        borderWidth: 3,
        borderColor: error ? '#ff3147' : focused ? '#2f6bff' : '#191017',
        borderRadius: 6,
        paddingHorizontal: 13,
        paddingVertical: 11,
        width: '100%',
        includeFontPadding: false,
        textAlignVertical: 'center',
      }}
    />
  )
}

/**
 * Input — single-line text field with optional label and hint.
 */
export function Input({ label, hint, error, secureTextEntry, ...rest }: InputProps) {
  const passwordProps =
    secureTextEntry && Platform.OS === 'web'
      ? ({ secureTextEntry: true, type: 'password' } as Record<string, unknown>)
      : { secureTextEntry }
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
      {Platform.OS === 'android' ? (
        <AndroidField
          error={!!error}
          secureTextEntry={secureTextEntry}
          {...(rest as unknown as TextInputProps)}
        />
      ) : (
        <Field {...quick} error={!!error} {...passwordProps} {...rest} />
      )}
      {error || hint ? (
        <Text fontSize={12} color={error ? '$verdictNah2' : '$ink500'}>
          {error || hint}
        </Text>
      ) : null}
    </View>
  )
}

export default Input
