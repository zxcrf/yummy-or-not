/* ============================================================
   YUMMY OR NOT — LangSwitcher (plain RN + Reanimated)
   Prominent, on-brand language picker. Controlled via `value` +
   `onChange(code)`; persistence is handled elsewhere. Shows the current
   language as a candy pill and opens a dropdown of options.

   Native-only: menu is rendered in a Modal so it floats above
   ScrollViews and sibling content without any stacking-context issues.
   Web target has been dropped; the portal/document branch is removed.
   ============================================================ */

import { useRef, useState } from 'react'
import {
  Dimensions,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TouchableWithoutFeedback,
  View,
  View as RNView,
  type StyleProp,
  type ViewProps,
  type ViewStyle,
} from 'react-native'
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated'
import { colors, radius, space } from '@/theme'
import { usePressScale } from '@/theme/usePressMotion'
import { Icon } from './Icon'

export interface LangEntry {
  code: string
  label: string
  native: string
}

const LANG_FLAGS: Record<string, string> = {
  zh: '🇨🇳',
  en: '🇺🇸',
  ko: '🇰🇷',
  ja: '🇯🇵',
  es: '🇪🇸',
}

export interface LangSwitcherProps {
  value?: string
  onChange?: (code: string) => void
  languages?: LangEntry[]
  align?: 'left' | 'right'
  /** Resolved color string (hex). Use colors.candyPink etc — NOT Tamagui token strings. */
  tone?: string
  triggerMode?: 'label' | 'flag'
  /** Style applied to the root wrapper View (e.g. margin, position). */
  style?: StyleProp<ViewStyle>
  /** testID forwarded to the root wrapper View. */
  testID?: string
  /** accessibilityLabel forwarded to the root wrapper View. */
  accessibilityLabel?: string
}

const styles = StyleSheet.create({
  triggerBase: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    borderWidth: 3,
    borderColor: colors.ink900,
    borderRadius: radius.pill,
  },
  triggerFlag: {
    width: 44,
    height: 42,
    justifyContent: 'center',
    paddingHorizontal: space[2],
  },
  menu: {
    minWidth: 220,
    backgroundColor: colors.white,
    borderWidth: 3,
    borderColor: colors.ink900,
    borderRadius: radius.md,
    paddingVertical: space[1],
    overflow: 'hidden',
    shadowColor: colors.ink900,
    shadowOffset: { width: 4, height: 4 },
    shadowOpacity: 1,
    shadowRadius: 0,
  },
  menuOpt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
  },
  menuOptActive: {
    backgroundColor: colors.paper2,
  },
  menuNativeText: {
    color: colors.ink900,
    fontWeight: '700',
    fontSize: 14,
    flex: 1,
  },
  menuLabelText: {
    color: colors.colorMuted,
    fontSize: 12,
  },
  triggerLabelText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
})

/**
 * FlagText — renders the emoji flag for the trigger's flag mode.
 * `lineHeight` and `textAlign` are passed as direct props so the
 * LangSwitcherFlag test can assert them via `flagText.props.lineHeight`
 * and `flagText.props.textAlign` (matching the original Tamagui Text API).
 * The Android-only centering style is a separate plain-object `style` prop,
 * also directly visible on the rendered node.
 * The `as any` casts are intentional: plain RN TextProps does not expose
 * lineHeight/textAlign as top-level props, but they are safe to pass and
 * the test renderer surfaces them as-is.
 */
function FlagText({ flagChar }: { flagChar: string }) {
  const extraProps = { lineHeight: 22, textAlign: 'center' } as any
  const androidStyle =
    Platform.OS === 'android'
      ? ({ includeFontPadding: false, textAlignVertical: 'center' } as any)
      : undefined
  return (
    <Text style={androidStyle} {...extraProps}>
      {flagChar}
    </Text>
  )
}

export function LangSwitcher({
  value,
  onChange,
  languages = [],
  align = 'left',
  tone = colors.candyBlue,
  triggerMode = 'label',
  style,
  testID,
  accessibilityLabel,
}: LangSwitcherProps) {
  const [open, setOpen] = useState(false)
  const [nativePos, setNativePos] = useState<{ top: number; left?: number; right?: number }>({ top: 0 })
  const triggerRef = useRef<View>(null)

  const current = languages.find((l) => l.code === value) ||
    languages[0] || { code: '', native: '—', label: '' }
  const currentFlag = LANG_FLAGS[current.code] ?? '🏳️'

  const pressDriver = usePressScale({ toScale: 0.95, toOpacity: 0.85 })

  const handleOpen = () => {
    triggerRef.current?.measureInWindow((x: number, y: number, w: number, h: number) => {
      const { width: screenWidth } = Dimensions.get('window')
      setNativePos(
        align === 'right'
          ? { top: y + h + 4, right: screenWidth - x - w }
          : { top: y + h + 4, left: x }
      )
      setOpen(true)
    })
  }

  const menuItems = languages.map((l) => {
    const on = l.code === value
    return (
      <Pressable
        key={l.code}
        accessibilityRole="button"
        accessibilityState={{ selected: on }}
        onPress={() => {
          onChange?.(l.code)
          setOpen(false)
        }}
        style={({ pressed }) => [styles.menuOpt, (pressed || on) && styles.menuOptActive]}
      >
        <Text style={styles.menuNativeText}>{l.native}</Text>
        <Text style={styles.menuLabelText}>{l.label}</Text>
        {on ? <Icon name="check" size={16} color="#0a9b51" /> : null}
      </Pressable>
    )
  })

  return (
    <View
      style={[{ alignSelf: 'flex-start' }, style]}
      testID={testID}
      accessibilityLabel={accessibilityLabel}
    >
      <Pressable
        ref={triggerRef}
        accessibilityRole="button"
        accessibilityLabel={current.label || current.native}
        accessibilityState={{ expanded: open }}
        onPressIn={(e) => { pressDriver.onPressIn(); }}
        onPressOut={(e) => { pressDriver.onPressOut(); }}
        onPress={handleOpen}
      >
        <Animated.View
          style={[
            styles.triggerBase,
            triggerMode === 'flag' ? styles.triggerFlag : undefined,
            { backgroundColor: triggerMode === 'flag' ? colors.white : tone },
            pressDriver.animatedStyle,
          ]}
        >
          {triggerMode === 'flag' ? (
            <FlagText flagChar={currentFlag} />
          ) : (
            <>
              <Icon name="flag" size={15} color="#fff" />
              <Text style={styles.triggerLabelText}>{current.native}</Text>
              <Icon name={open ? 'chevron-up' : 'chevron-down'} size={14} color="#fff" />
            </>
          )}
        </Animated.View>
      </Pressable>

      {/* Modal so menu floats above ScrollView and all sibling content */}
      {open ? (
        <Modal transparent visible animationType="none" onRequestClose={() => setOpen(false)}>
          <TouchableWithoutFeedback onPress={() => setOpen(false)}>
            <RNView style={{ flex: 1 }}>
              <Animated.View
                entering={FadeIn.duration(150)}
                exiting={FadeOut.duration(100)}
                style={[{ position: 'absolute' }, nativePos]}
              >
                <View style={styles.menu}>
                  {menuItems}
                </View>
              </Animated.View>
            </RNView>
          </TouchableWithoutFeedback>
        </Modal>
      ) : null}
    </View>
  )
}

export default LangSwitcher
