/* ============================================================
   Regression tests — DetailView keyboard UX parity with AddModal.

   Three pins for the "editing a taste doesn't ride the keyboard" bug:

   1. Inline edit form: the outer scroll must be a
      `KeyboardAwareScrollView` (carries `bottomOffset`) so focusing a
      field shifts content above the keyboard. The old code used a plain
      RN `ScrollView` with no keyboard handling — the field/cursor and the
      save row stayed hidden behind the keyboard.

   2. "+1 Again" sheet: the price/place inputs must sit inside a
      `KeyboardStickyView` so the sheet rides up with the keyboard.

   3. Promote (转正) sheet: the price input must sit inside a
      `KeyboardStickyView` for the same reason.

   The keyboard-controller components are mocked here as identifiable host
   elements (data-testid) so the assertions fail against the old bare
   ScrollView / unwrapped sheets.
   ============================================================ */

import TestRenderer, { act } from 'react-test-renderer'
import DetailView from '../DetailView'

// ---- identifiable keyboard-controller mock --------------------------------
// The shared jest.setup mock aliases these to plain RN View/ScrollView, which
// can't be told apart from any other scroll/view. Override locally with tagged
// host elements so we can pin that the form / sheets are actually wrapped.
jest.mock('react-native-keyboard-controller', () => {
  const React = require('react')
  return {
    KeyboardAwareScrollView: ({
      children,
      bottomOffset,
    }: {
      children: React.ReactNode
      bottomOffset?: number
    }) =>
      React.createElement(
        'KeyboardAwareScrollView',
        { 'data-testid': 'kaw-scroll', bottomOffset },
        children,
      ),
    KeyboardStickyView: ({ children }: { children: React.ReactNode }) =>
      React.createElement('KeyboardStickyView', { 'data-testid': 'kbd-sticky' }, children),
  }
})

// ---- mock react-native (Modal renders children when visible) --------------

jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native')
  return new Proxy(actual, {
    get(target, prop, receiver) {
      if (prop === 'Alert') return { alert: jest.fn() }
      if (prop === 'Modal') {
        return ({ visible, children }: { visible: boolean; children: React.ReactNode }) =>
          visible ? <div data-testid="modal">{children}</div> : null
      }
      if (prop === 'Pressable') {
        return ({ children, onPress }: {
          children: React.ReactNode | ((s: { pressed: boolean }) => React.ReactNode)
          onPress?: () => void
        }) => (
          <div onClick={onPress}>
            {typeof children === 'function' ? children({ pressed: false }) : children}
          </div>
        )
      }
      if (prop === 'StyleSheet') return { create: (s: unknown) => s }
      if (prop === 'Platform') return { OS: 'ios' }
      if (prop === 'ActivityIndicator') return () => null
      return Reflect.get(target, prop, receiver)
    },
  })
})

// ---- mock shared ----------------------------------------------------------

const mockGetTaste = jest.fn()
const mockUpdateTaste = jest.fn()
const mockAddPurchase = jest.fn()

jest.mock('@yon/shared', () => ({
  TAG_CHOICES: ['Coffee'],
  getTaste: (...args: unknown[]) => mockGetTaste(...args),
  updateTaste: (...args: unknown[]) => mockUpdateTaste(...args),
  deleteTaste: jest.fn(),
  addPurchase: (...args: unknown[]) => mockAddPurchase(...args),
  getOriginalPhotoUrl: jest.fn(),
  ProRequiredError: class ProRequiredError extends Error {},
}))

// ---- mock hooks / providers ----------------------------------------------

const mockInvalidateTastes = jest.fn()
jest.mock('@/app/(tabs)/_useTastes', () => ({
  getCachedTaste: (id: string) => {
    if (id === 'tasted-1') {
      return {
        id: 'tasted-1', name: 'Espresso', place: 'Cafe', price: '4.00',
        status: 'tasted', verdict: 'yum', tags: [], boughtCount: 1,
        warnBeforeBuy: false, purchases: [], date: 'today', notes: '',
        image: '', imageThumb: '', imageDisplay: '', imageKey: '',
        createdAt: '2026-06-11T00:00:00.000Z',
      }
    }
    if (id === 'todo-1') {
      return {
        id: 'todo-1', name: 'Matcha Latte', place: 'Tea Bar', price: '',
        status: 'todo', verdict: null, tags: [], boughtCount: 0,
        warnBeforeBuy: false, purchases: [], date: 'today', notes: '',
        image: '', imageThumb: '', imageDisplay: '', imageKey: '',
        createdAt: '2026-06-11T00:00:00.000Z',
      }
    }
    return undefined
  },
  invalidateTastes: () => mockInvalidateTastes(),
}))

jest.mock('@/app/(tabs)/_useTags', () => ({
  useTags: () => ({ tags: [] }),
  invalidateTagsCache: jest.fn(),
}))

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), replace: jest.fn(), canGoBack: () => true }),
  useLocalSearchParams: () => ({ id: 'tasted-1' }),
}))

jest.mock('expo-image', () => ({ Image: () => null }))
jest.mock('expo-sharing', () => ({ isAvailableAsync: async () => false }))
jest.mock('react-native-view-shot', () => ({ captureRef: jest.fn() }))

jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({ user: { warningsEnabled: true, plan: 'free', locationEnabled: false } }),
}))

jest.mock('@/providers/I18nProvider', () => ({
  useI18n: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        cancel: 'Cancel', edit: 'Edit', del: 'Delete',
        detail_buy_again: '+1 Again', warn_before: 'Warn before buying',
        promote_cta: 'Ate it? Rate it', promote_title: 'How was it?',
        promote_confirm: 'Save rating', f_price: 'Price', f_what: 'What?',
        f_where: 'Where?', how_was_it: 'How was it?', tags: 'Tags',
        your_take: 'Your take', save_taste_web: 'Save',
        v_yum: 'YUM', v_meh: 'MEH', v_nah: 'NAH',
        detail_buy_again_title: 'Log another purchase',
        detail_buy_again_confirm: 'Confirm purchase',
      }
      return map[key] ?? key
    },
    formatMoney: (p: string | number) => String(p),
  }),
}))

jest.mock('../ShareCard', () => ({ ShareCard: () => null }))
jest.mock('@/components/app/ShareCard', () => ({ ShareCard: () => null }))

jest.mock('@/components/ds', () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Button: ({ children, onPress, disabled, testID }: {
    children: React.ReactNode; onPress?: () => void; disabled?: boolean; testID?: string
  }) => <button onClick={onPress} disabled={disabled} data-testid={testID}>{children}</button>,
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Icon: ({ name }: { name: string }) => <span data-icon={name} />,
  IconButton: ({ children, onPress }: { children: React.ReactNode; onPress?: () => void }) => (
    <button onClick={onPress}>{children}</button>
  ),
  Input: ({ value, onChangeText, label, testID }: {
    value: string; onChangeText?: (t: string) => void; label?: string; testID?: string
  }) => {
    const { TextInput } = require('react-native')
    return <TextInput accessibilityLabel={label} value={value} onChangeText={onChangeText} testID={testID} />
  },
  Switch: ({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) => (
    <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
  ),
  Tag: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Textarea: ({ value, onChangeText, label }: {
    value: string; onChangeText?: (t: string) => void; label?: string
  }) => {
    const { TextInput } = require('react-native')
    return <TextInput accessibilityLabel={label} value={value} onChangeText={onChangeText} multiline />
  },
  VerdictPicker: ({ value, onChange }: { value: string | null; onChange: (v: string) => void }) => (
    <div data-testid="verdict-picker">
      {(['yum', 'meh', 'nah'] as const).map((v) => (
        <button key={v} data-testid={`verdict-${v}`} onClick={() => onChange(v)}>{v}</button>
      ))}
    </div>
  ),
  VerdictStamp: ({ verdict }: { verdict: string }) => <span data-verdict={verdict} />,
}))

// ---- helpers --------------------------------------------------------------

const mountedRenderers: TestRenderer.ReactTestRenderer[] = []
afterEach(() => {
  act(() => { mountedRenderers.forEach((r) => r.unmount()) })
  mountedRenderers.length = 0
})

async function renderForId(id: string) {
  const ExpoRouter = jest.requireMock('expo-router') as { useLocalSearchParams: () => { id: string } }
  ;(ExpoRouter as { useLocalSearchParams: () => { id: string } }).useLocalSearchParams = () => ({ id })
  let renderer!: TestRenderer.ReactTestRenderer
  await act(async () => {
    renderer = TestRenderer.create(<DetailView />)
  })
  mountedRenderers.push(renderer)
  return renderer
}

function byTestId(r: TestRenderer.ReactTestRenderer, id: string) {
  return r.root.findAll((n) => n.props['data-testid'] === id || n.props.testID === id)
}

/** Press a tagged control, tolerating both the composite (onPress) and the
 *  host (onClick) node that share the id. */
function press(r: TestRenderer.ReactTestRenderer, id: string) {
  const node = r.root.findAll(
    (n) =>
      (n.props['data-testid'] === id || n.props.testID === id) &&
      (typeof n.props.onClick === 'function' || typeof n.props.onPress === 'function'),
  )[0]
  act(() => { (node.props.onClick ?? node.props.onPress)() })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockGetTaste.mockResolvedValue(undefined)
})

describe('DetailView keyboard parity', () => {
  it('inline edit form lives inside a KeyboardAwareScrollView with bottomOffset', async () => {
    const renderer = await renderForId('tasted-1')

    // Enter edit mode.
    const editBtn = renderer.root.findAll(
      (n) => (n.type as unknown) === 'button' && n.props.children === 'Edit',
    )[0]
    act(() => { editBtn.props.onClick() })

    // The outer scroll must be the KeyboardAwareScrollView (bottomOffset set).
    const kaw = byTestId(renderer, 'kaw-scroll')
    expect(kaw).toHaveLength(1)
    expect(typeof kaw[0].props.bottomOffset).toBe('number')
    expect(kaw[0].props.bottomOffset as number).toBeGreaterThan(0)

    // And the editable name field must render inside it (content rides up).
    const nameInside = kaw[0].findAll((n) => n.props.accessibilityLabel === 'What?')
    expect(nameInside.length).toBeGreaterThan(0)
  })

  it('+1 Again sheet inputs sit inside a KeyboardStickyView', async () => {
    const renderer = await renderForId('tasted-1')

    press(renderer, 'buy-again-btn')

    const stickies = byTestId(renderer, 'kbd-sticky')
    const priceInsideSticky = stickies.some(
      (s) => s.findAll((n) => n.props.testID === 'buy-price-input').length > 0,
    )
    expect(priceInsideSticky).toBe(true)
  })

  it('promote sheet input sits inside a KeyboardStickyView', async () => {
    const renderer = await renderForId('todo-1')

    press(renderer, 'promote-btn')

    const stickies = byTestId(renderer, 'kbd-sticky')
    const priceInsideSticky = stickies.some(
      (s) => s.findAll((n) => n.props.testID === 'promote-price-input').length > 0,
    )
    expect(priceInsideSticky).toBe(true)
  })
})
