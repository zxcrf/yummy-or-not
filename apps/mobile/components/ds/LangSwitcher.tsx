/* ============================================================
   YUMMY OR NOT — LangSwitcher (Tamagui / React Native)
   Prominent, on-brand language picker. Controlled via `value` +
   `onChange(code)`; persistence is handled elsewhere. Shows the current
   language as a candy pill and opens a dropdown of options.

   On web the menu is rendered via ReactDOM.createPortal at document.body so
   it escapes any ancestor stacking context. On native it uses position:
   absolute within the wrapper (no DOM, no stacking issue).
   ============================================================ */

import { useEffect, useRef, useState } from 'react'
import { Dimensions, Modal, Platform, TouchableWithoutFeedback, View as RNView } from 'react-native'
import Animated, { FadeIn } from 'react-native-reanimated'
import { type GetProps, View, styled, Text } from 'tamagui'
import { Icon } from './Icon'
import { quick } from './animation'

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

const Trigger = styled(View, {
  name: 'LangSwitcherTrigger',
  flexDirection: 'row',
  alignItems: 'center',
  gap: 6,
  paddingHorizontal: '$3',
  paddingVertical: '$2',
  borderWidth: 3,
  borderColor: '$ink900',
  borderRadius: '$pill',
  cursor: 'pointer',
  pressStyle: {
    scale: 0.95,
    opacity: 0.85,
  },
})

const Menu = styled(View, {
  name: 'LangSwitcherMenu',
  position: 'absolute',
  minWidth: 220,
  backgroundColor: '$white',
  borderWidth: 3,
  borderColor: '$ink900',
  borderRadius: '$md',
  paddingVertical: '$1',
  zIndex: 99999,
  overflow: 'hidden',
  shadowColor: '$ink900',
  shadowOffset: { width: 4, height: 4 },
  shadowOpacity: 1,
  shadowRadius: 0,
})

const MenuOpt = styled(View, {
  name: 'LangSwitcherOpt',
  flexDirection: 'row',
  alignItems: 'center',
  gap: 8,
  paddingHorizontal: '$3',
  paddingVertical: '$2',
  cursor: 'pointer',
  hoverStyle: { backgroundColor: '$paper2' },
  pressStyle: { backgroundColor: '$paper2' },
})

export type LangSwitcherProps = Omit<GetProps<typeof View>, 'onChange'> & {
  value?: string
  onChange?: (code: string) => void
  languages?: LangEntry[]
  align?: 'left' | 'right'
  tone?: GetProps<typeof Trigger>['backgroundColor']
  triggerMode?: 'label' | 'flag'
}

export function LangSwitcher({
  value,
  onChange,
  languages = [],
  align = 'left',
  tone = '$candyBlue',
  triggerMode = 'label',
  ...rest
}: LangSwitcherProps) {
  const [open, setOpen] = useState(false)
  const [menuStyle, setMenuStyle] = useState<Record<string, number>>({})
  const [nativePos, setNativePos] = useState<{ top: number; left?: number; right?: number }>({ top: 0 })
  const triggerRef = useRef<any>(null)
  const wrapperRef = useRef<any>(null)
  const current = languages.find((l) => l.code === value) ||
    languages[0] || { code: '', native: '—', label: '' }
  const currentFlag = LANG_FLAGS[current.code] ?? '🏳️'

  const handleOpen = () => {
    if (Platform.OS === 'web' && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      setMenuStyle(
        align === 'right'
          ? { top: rect.bottom + 4, right: window.innerWidth - rect.right }
          : { top: rect.bottom + 4, left: rect.left }
      )
      setOpen((o) => !o)
    } else if (Platform.OS !== 'web') {
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
  }

  // Close on outside click (web only)
  useEffect(() => {
    if (!open || Platform.OS !== 'web') return
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      if (
        wrapperRef.current && !wrapperRef.current.contains(target) &&
        !(e.target as Element).closest?.('[data-lang-menu]')
      ) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const menuItems = languages.map((l) => {
    const on = l.code === value
    return (
      <MenuOpt
        key={l.code}
        accessibilityRole="button"
        aria-selected={on}
        onPress={() => {
          onChange?.(l.code)
          setOpen(false)
        }}
      >
        <Text color="$ink900" fontWeight="700" fontSize={14} flex={1}>
          {l.native}
        </Text>
        <Text color="$colorMuted" fontSize={12}>
          {l.label}
        </Text>
        {on ? <Icon name="check" size={16} color="#0a9b51" /> : null}
      </MenuOpt>
    )
  })

  // Web: portal to document.body so menu escapes ancestor stacking contexts
  const webMenu = open && Platform.OS === 'web' ? (() => {
    const { createPortal } = require('react-dom')
    return createPortal(
      <Menu
        data-lang-menu="true"
        style={{ position: 'fixed', ...menuStyle } as any}
      >
        {menuItems}
      </Menu>,
      document.body
    )
  })() : null

  return (
    <View ref={wrapperRef} position="relative" alignSelf="flex-start" {...rest}>
      <View ref={triggerRef}>
        <Trigger
          {...quick}
          backgroundColor={triggerMode === 'flag' ? '$white' : tone}
          accessibilityRole="button"
          aria-label={current.label || current.native}
          aria-expanded={open}
          width={triggerMode === 'flag' ? 44 : undefined}
          height={triggerMode === 'flag' ? 42 : undefined}
          justifyContent={triggerMode === 'flag' ? 'center' : undefined}
          paddingHorizontal={triggerMode === 'flag' ? '$2' : '$3'}
          paddingVertical="$2"
          onPress={handleOpen}
        >
          {triggerMode === 'flag' ? (
            <Text
              fontSize={22}
              lineHeight={22}
              textAlign="center"
              {...(Platform.OS === 'android'
                ? {
                    style: {
                      includeFontPadding: false,
                      textAlignVertical: 'center',
                    },
                  }
                : {})}
            >
              {currentFlag}
            </Text>
          ) : (
            <>
              <Icon name="flag" size={15} color="#fff" />
              <Text color="#fff" fontWeight="700" fontSize={14}>
                {current.native}
              </Text>
              <Icon name={open ? 'chevron-up' : 'chevron-down'} size={14} color="#fff" />
            </>
          )}
        </Trigger>
      </View>

      {/* Native: Modal so menu floats above ScrollView and all sibling content */}
      {Platform.OS !== 'web' && open ? (
        <Modal transparent visible animationType="none" onRequestClose={() => setOpen(false)}>
          <TouchableWithoutFeedback onPress={() => setOpen(false)}>
            <RNView style={{ flex: 1 }}>
              <Animated.View entering={FadeIn.duration(150)} style={{ position: 'absolute', ...nativePos }}>
                <Menu position="relative">
                  {menuItems}
                </Menu>
              </Animated.View>
            </RNView>
          </TouchableWithoutFeedback>
        </Modal>
      ) : null}

      {webMenu}
    </View>
  )
}

export default LangSwitcher
