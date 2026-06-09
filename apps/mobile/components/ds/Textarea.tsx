/* ============================================================
   YUMMY OR NOT — Textarea (Tamagui / React Native)
   Multi-line text field with optional uppercase pixel label and
   hint. Ported from the web DS: chunky ink border, hard blue focus
   shadow; error state turns the border red. Wraps Tamagui TextArea.
   ============================================================ */

import { useState } from 'react'
import { Platform, TextInput as RNTextInput, type TextInputProps } from 'react-native'
import { type GetProps, styled, TextArea as TTextArea, Text, View } from 'tamagui'
import { quick } from './animation'

const Field = styled(TTextArea, {
  name: 'Textarea',
  fontSize: 16,
  color: '#191017', // hardcoded: Tamagui theme token doesn't reach Android TextInput text color
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
 * Android renders a raw RN TextInput (multiline) — Tamagui's styled(TextArea)
 * doesn't forward the resolved text `color` to the native input on release
 * builds, so typed characters come out invisible. Plain RN style guarantees it.
 * Web/iOS keep `Field` for the hard pop-shadow focus look.
 */
function AndroidField({ error, ...props }: TextInputProps & { error?: boolean }) {
  const [focused, setFocused] = useState(false)
  return (
    <RNTextInput
      {...props}
      multiline
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
        color: '#191017',
        backgroundColor: '#ffffff',
        borderWidth: 3,
        borderColor: error ? '#ff3147' : focused ? '#2f6bff' : '#191017',
        borderRadius: 6,
        paddingHorizontal: 13,
        paddingVertical: 11,
        width: '100%',
        minHeight: 88,
        includeFontPadding: false,
        textAlignVertical: 'top',
      }}
    />
  )
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
      {Platform.OS === 'android' ? (
        <AndroidField error={!!error} {...(rest as unknown as TextInputProps)} />
      ) : (
        <Field {...quick} error={!!error} {...rest} />
      )}
      {error || hint ? (
        <Text fontSize={12} color={error ? '$verdictNah2' : '$ink500'}>
          {error || hint}
        </Text>
      ) : null}
    </View>
  )
}

export default Textarea
