/* ============================================================
   YUMMY OR NOT — Input (plain React Native)
   Single-line text field with optional uppercase pixel label and
   hint. Chunky ink border, blue focus; error state turns border red.
   Single path: raw RN TextInput (no Tamagui, no Platform branch).
   ============================================================ */

import { useState } from 'react'
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  type TextInputProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native'
import { colors, radius } from '@/theme'

// Exported for testing: '#191017' must be a concrete hex, not a Tamagui token ($ink900
// doesn't reach Android TextInput's text color — typed characters become invisible).
export const _FIELD_COLOR = '#191017' as const

export type InputProps = TextInputProps & {
  /** Uppercase pixel label above the field. */
  label?: string
  /** Helper text below the field. */
  hint?: string
  /** Error message (replaces hint and turns the field red). */
  error?: string
  /** Optional container style pass-through. */
  containerStyle?: StyleProp<ViewStyle>
}

/**
 * Input — single-line text field with optional label and hint.
 * All platforms use the same raw RN TextInput path (no Tamagui, no web branch).
 */
export function Input({ label, hint, error, containerStyle, ...rest }: InputProps) {
  const [focused, setFocused] = useState(false)
  const borderColor = error ? colors.verdictNah : focused ? '#2f6bff' : colors.ink900

  return (
    <View style={[styles.container, containerStyle]}>
      {label ? (
        <Text style={styles.label}>{label}</Text>
      ) : null}
      <TextInput
        {...rest}
        onFocus={(e) => {
          setFocused(true)
          rest.onFocus?.(e)
        }}
        onBlur={(e) => {
          setFocused(false)
          rest.onBlur?.(e)
        }}
        placeholderTextColor="#8f8189"
        selectionColor="#2f6bff"
        style={[
          styles.field,
          { borderColor },
          rest.style,
        ]}
      />
      {error || hint ? (
        <Text style={[styles.hint, error ? styles.hintError : null]}>
          {error || hint}
        </Text>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    gap: 6,
    width: '100%',
  },
  label: {
    color: colors.ink700,
    fontSize: 11,
    letterSpacing: 1.92,
    textTransform: 'uppercase',
  },
  field: {
    fontSize: 16,
    color: _FIELD_COLOR,
    backgroundColor: colors.white,
    borderWidth: 3,
    borderRadius: radius.sm,
    paddingHorizontal: 13,
    paddingVertical: 11,
    width: '100%',
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  hint: {
    fontSize: 12,
    color: colors.ink500,
  },
  hintError: {
    color: colors.verdictNah2,
  },
})

export default Input
