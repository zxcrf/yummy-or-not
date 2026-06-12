/* ============================================================
   YUMMY OR NOT — Textarea (plain React Native)
   Multi-line text field with optional uppercase pixel label and
   hint. Chunky ink border, blue focus; error state turns border red.
   Single path: raw RN TextInput multiline (no Tamagui, no Platform branch).
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

export type TextareaProps = TextInputProps & {
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
 * Textarea — multi-line text field with optional label and hint.
 * All platforms use the same raw RN TextInput (multiline) path.
 */
export function Textarea({ label, hint, error, containerStyle, ...rest }: TextareaProps) {
  const [focused, setFocused] = useState(false)
  const borderColor = error ? colors.verdictNah : focused ? '#2f6bff' : colors.ink900

  return (
    <View style={[styles.container, containerStyle]}>
      {label ? (
        <Text style={styles.label}>{label}</Text>
      ) : null}
      <TextInput
        {...rest}
        multiline
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
    color: '#191017',
    backgroundColor: colors.white,
    borderWidth: 3,
    borderRadius: radius.sm,
    paddingHorizontal: 13,
    paddingVertical: 11,
    width: '100%',
    minHeight: 88,
    includeFontPadding: false,
    textAlignVertical: 'top',
  },
  hint: {
    fontSize: 12,
    color: colors.ink500,
  },
  hintError: {
    color: colors.verdictNah2,
  },
})

export default Textarea
