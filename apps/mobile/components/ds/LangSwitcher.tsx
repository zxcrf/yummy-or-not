/* ============================================================
   YUMMY OR NOT — LangSwitcher (Tamagui / React Native)
   Prominent, on-brand language picker. Controlled via `value` +
   `onChange(code)`; persistence is handled elsewhere. Shows the current
   language as a candy pill and opens a dropdown of options.

   Ported from the web DS. The web version closed on document mousedown
   (a DOM-only affordance); RN has no document, so this opens/closes a
   panel on tap of the trigger / an option. The `languages` list is
   passed in by the caller (the screens feed LANGS from @yon/shared) —
   same `languages` prop the web component accepted.
   ============================================================ */

import { useState } from 'react'
import { type GetProps, View, styled, Text } from 'tamagui'
import { Icon } from './Icon'

export interface LangEntry {
  code: string
  label: string
  native: string
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
})

const Menu = styled(View, {
  name: 'LangSwitcherMenu',
  position: 'absolute',
  top: '100%',
  marginTop: '$1',
  minWidth: 180,
  backgroundColor: '$white',
  borderWidth: 3,
  borderColor: '$ink900',
  borderRadius: '$md',
  paddingVertical: '$1',
  zIndex: 1000,
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
  /** Currently selected language code. */
  value?: string
  /** Called with the chosen language code. */
  onChange?: (code: string) => void
  /** Available languages (screens pass LANGS from @yon/shared). */
  languages?: LangEntry[]
  /** Dropdown alignment. */
  align?: 'left' | 'right'
  /** Background color of the trigger pill (token name or color string). */
  tone?: GetProps<typeof Trigger>['backgroundColor']
}

/**
 * LangSwitcher — on-brand language picker. Controlled via `value` + `onChange`.
 */
export function LangSwitcher({
  value,
  onChange,
  languages = [],
  align = 'left',
  tone = '$candyBlue',
  ...rest
}: LangSwitcherProps) {
  const [open, setOpen] = useState(false)
  const current = languages.find((l) => l.code === value) ||
    languages[0] || { code: '', native: '—', label: '' }

  return (
    <View position="relative" alignSelf="flex-start" {...rest}>
      <Trigger
        backgroundColor={tone}
        accessibilityRole="button"
        aria-expanded={open}
        onPress={() => setOpen((o) => !o)}
      >
        <Icon name="flag" size={15} color="#fff" />
        <Text color="#fff" fontWeight="700" fontSize={14}>
          {current.native}
        </Text>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={14} color="#fff" />
      </Trigger>

      {open ? (
        <Menu {...(align === 'right' ? { right: 0 } : { left: 0 })}>
          {languages.map((l) => {
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
          })}
        </Menu>
      ) : null}
    </View>
  )
}

export default LangSwitcher
