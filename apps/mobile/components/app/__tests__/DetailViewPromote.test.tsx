/* ============================================================
   Regression tests — DetailView A2 promote (转正) flow.
   Pins:
   1. todo item: promote_cta button renders; warn toggle hidden; buy-again hidden.
   2. Pressing promote_cta opens the promote sheet with VerdictPicker.
   3. Confirm patches {status:'tasted', verdict} and flips item in UI.
   4. tasted item: promote_cta absent; warn toggle present; buy-again present.
   ============================================================ */

import TestRenderer, { act } from 'react-test-renderer'
import DetailView from '../DetailView'
import type { Taste } from '@yon/shared'

// ---- mock react-native ----------------------------------------------------

jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native')
  return new Proxy(actual, {
    get(target, prop, receiver) {
      if (prop === 'Alert') return { alert: jest.fn() }
      if (prop === 'Modal') {
        return ({
          visible,
          children,
        }: {
          visible: boolean
          children: React.ReactNode
        }) => (visible ? <div data-testid="modal">{children}</div> : null)
      }
      if (prop === 'Pressable') {
        return ({ children, onPress, style }: {
          children: React.ReactNode | ((state: { pressed: boolean }) => React.ReactNode)
          onPress?: () => void
          style?: unknown
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
const mockDeleteTaste = jest.fn()
const mockAddPurchase = jest.fn()
const mockGetOriginalPhotoUrl = jest.fn()

jest.mock('@yon/shared', () => ({
  TAG_CHOICES: ['Coffee'],
  getTaste: (...args: unknown[]) => mockGetTaste(...args),
  updateTaste: (...args: unknown[]) => mockUpdateTaste(...args),
  deleteTaste: (...args: unknown[]) => mockDeleteTaste(...args),
  addPurchase: (...args: unknown[]) => mockAddPurchase(...args),
  getOriginalPhotoUrl: (...args: unknown[]) => mockGetOriginalPhotoUrl(...args),
  getTags: jest.fn().mockResolvedValue([]),
  ProRequiredError: class ProRequiredError extends Error {
    constructor() { super('pro_required'); this.name = 'ProRequiredError' }
  },
}))

// ---- mock _useTastes ------------------------------------------------------

const mockInvalidateTastes = jest.fn()
jest.mock('@/app/(tabs)/_useTastes', () => ({
  getCachedTaste: (id: string) => {
    if (id === 'todo-1') {
      return {
        id: 'todo-1', name: 'Matcha Latte', place: 'Tea Bar', price: '',
        status: 'todo', verdict: null, tags: [], boughtCount: 0,
        warnBeforeBuy: false, purchases: [], date: 'today', notes: '',
        image: '', imageThumb: '', imageDisplay: '', imageKey: '',
        createdAt: '2026-06-11T00:00:00.000Z',
      }
    }
    if (id === 'tasted-1') {
      return {
        id: 'tasted-1', name: 'Espresso', place: 'Cafe', price: '4.00',
        status: 'tasted', verdict: 'yum', tags: [], boughtCount: 1,
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

// ---- mock expo-router -----------------------------------------------------

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), replace: jest.fn(), canGoBack: () => true }),
  useLocalSearchParams: () => ({ id: 'todo-1' }),
}))

// ---- mock expo-image / expo-sharing / react-native-view-shot --------------

jest.mock('expo-image', () => ({ Image: () => null }))
jest.mock('expo-sharing', () => ({ isAvailableAsync: async () => false }))
jest.mock('react-native-view-shot', () => ({ captureRef: jest.fn() }))

// ---- mock providers -------------------------------------------------------

jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({
    user: { warningsEnabled: true, plan: 'free', locationEnabled: false },
  }),
}))

jest.mock('@/providers/I18nProvider', () => ({
  useI18n: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        cancel: 'Cancel',
        edit: 'Edit',
        del: 'Delete',
        detail_buy_again: '+1 Again',
        warn_before: 'Warn before buying',
        promote_cta: 'Ate it? Rate it',
        promote_title: 'How was it?',
        promote_confirm: 'Save rating',
        f_price: 'Price',
        f_what: 'What?',
        f_where: 'Where?',
        v_yum: 'YUM', v_meh: 'MEH', v_nah: 'NAH',
        nothing_here: 'Nothing here.',
        your_note: 'Your note',
        share: 'Share',
        share_brand_tag: 'Logged with YON',
        bought_n: 'Bought {n}×',
        detail_buy_again_title: 'Log another purchase',
        detail_buy_again_confirm: 'Confirm purchase',
        detail_warn_banner: 'You said skip this',
        view_original: 'View original',
        view_original_pro: 'View original (Pro)',
      }
      return map[key] ?? key
    },
    formatMoney: (p: string | number) => String(p),
  }),
}))

// ---- mock ShareCard -------------------------------------------------------

jest.mock('../ShareCard', () => ({
  ShareCard: () => null,
}))
jest.mock('@/components/app/ShareCard', () => ({
  ShareCard: () => null,
}))

// ---- mock ds components ---------------------------------------------------

jest.mock('@/components/ds', () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Button: ({ children, onPress, disabled, testID }: {
    children: React.ReactNode; onPress?: () => void; disabled?: boolean; testID?: string
  }) => (
    <button onClick={onPress} disabled={disabled} data-testid={testID}>{children}</button>
  ),
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Icon: ({ name }: { name: string }) => <span data-icon={name} />,
  IconButton: ({ children, onPress }: { children: React.ReactNode; onPress?: () => void }) => (
    <button onClick={onPress}>{children}</button>
  ),
  Input: ({ value, onChangeText, label, testID }: {
    value: string; onChangeText?: (t: string) => void; label?: string; testID?: string
  }) => {
    const { TextInput } = require('react-native')
    return (
      <TextInput accessibilityLabel={label} value={value} onChangeText={onChangeText} testID={testID} />
    )
  },
  Switch: ({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) => (
    <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
  ),
  Tag: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Textarea: ({ value, onChangeText, label }: {
    value: string; onChangeText?: (t: string) => void; label?: string
  }) => {
    const { TextInput } = require('react-native')
    return (
      <TextInput accessibilityLabel={label} value={value} onChangeText={onChangeText} multiline />
    )
  },
  VerdictPicker: ({ value, onChange }: { value: string | null; onChange: (v: string) => void }) => (
    <div data-testid="promote-verdict-picker">
      {(['yum', 'meh', 'nah'] as const).map((v) => (
        <button key={v} data-testid={`verdict-${v}`} onClick={() => onChange(v)}>{v}</button>
      ))}
    </div>
  ),
  VerdictStamp: ({ verdict }: { verdict: string }) => <span data-verdict={verdict} />,
}))

// ---- taste fixtures -------------------------------------------------------

function todoTaste(): Taste {
  return {
    id: 'todo-1',
    name: 'Matcha Latte',
    place: 'Tea Bar',
    price: '',
    status: 'todo',
    verdict: null,
    tags: [],
    boughtCount: 0,
    warnBeforeBuy: false,
    purchases: [],
    date: 'today',
    notes: '',
    image: '',
    imageThumb: '',
    imageDisplay: '',
    imageKey: '',
    createdAt: '2026-06-11T00:00:00.000Z',
  }
}

function tastedTaste(): Taste {
  return {
    id: 'tasted-1',
    name: 'Espresso',
    place: 'Cafe',
    price: '4.00',
    status: 'tasted',
    verdict: 'yum',
    tags: [],
    boughtCount: 1,
    warnBeforeBuy: false,
    purchases: [],
    date: 'today',
    notes: '',
    image: '',
    imageThumb: '',
    imageDisplay: '',
    imageKey: '',
    createdAt: '2026-06-11T00:00:00.000Z',
  }
}

// ---- helpers --------------------------------------------------------------

function findByTestId(renderer: TestRenderer.ReactTestRenderer, testId: string) {
  return renderer.root.findAll((n) => n.props['data-testid'] === testId)
}

function findTextNodes(renderer: TestRenderer.ReactTestRenderer, text: string) {
  return renderer.root.findAll(
    (n) => typeof n.props.children === 'string' && n.props.children === text,
  )
}

const mountedRenderers: TestRenderer.ReactTestRenderer[] = []

afterEach(() => {
  act(() => { mountedRenderers.forEach((r) => r.unmount()) })
  mountedRenderers.length = 0
})

async function renderForId(id: string) {
  // Override the mock to use the given id
  const ExpoRouter = jest.requireMock('expo-router') as { useLocalSearchParams: jest.Mock }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(ExpoRouter as any).useLocalSearchParams = () => ({ id })
  let renderer!: TestRenderer.ReactTestRenderer
  await act(async () => {
    renderer = TestRenderer.create(<DetailView />)
  })
  mountedRenderers.push(renderer)
  return renderer
}

// ---- tests ----------------------------------------------------------------

describe('DetailView A2 — todo promote (转正)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockUpdateTaste.mockResolvedValue({
      ...todoTaste(),
      status: 'tasted',
      verdict: 'yum',
    })
  })

  it('todo item: promote_cta button is present, warn toggle absent, buy-again absent', async () => {
    const renderer = await renderForId('todo-1')

    // Promote CTA present
    const promoteBtns = findByTestId(renderer, 'promote-btn')
    expect(promoteBtns.length).toBeGreaterThan(0)
    expect(promoteBtns[0].props.children).toBe('Ate it? Rate it')

    // Warn toggle absent
    expect(findTextNodes(renderer, 'Warn before buying')).toHaveLength(0)

    // Buy-again absent
    expect(findByTestId(renderer, 'buy-again-btn')).toHaveLength(0)
  })

  it('pressing promote_cta opens the promote sheet with VerdictPicker', async () => {
    const renderer = await renderForId('todo-1')

    const promoteBtns = findByTestId(renderer, 'promote-btn')
    act(() => { promoteBtns[0].props.onClick() })

    // Promote sheet with VerdictPicker should be visible
    const pickers = findByTestId(renderer, 'promote-verdict-picker')
    expect(pickers.length).toBeGreaterThan(0)
  })

  it('confirm in promote sheet PATCHes {status:tasted, verdict} and invalidates', async () => {
    const renderer = await renderForId('todo-1')

    // Open sheet
    const promoteBtns = findByTestId(renderer, 'promote-btn')
    act(() => { promoteBtns[0].props.onClick() })

    // Pick verdict yum
    const yumBtn = findByTestId(renderer, 'verdict-yum')
    expect(yumBtn.length).toBeGreaterThan(0)
    act(() => { yumBtn[0].props.onClick() })

    // Press confirm
    const confirmBtns = findByTestId(renderer, 'promote-confirm-btn')
    expect(confirmBtns.length).toBeGreaterThan(0)
    await act(async () => { confirmBtns[0].props.onClick() })

    // updateTaste called with promote payload
    expect(mockUpdateTaste).toHaveBeenCalledWith('todo-1', {
      status: 'tasted',
      verdict: 'yum',
      price: undefined,
    })
    expect(mockInvalidateTastes).toHaveBeenCalled()
  })

  it('confirm disabled until verdict selected', async () => {
    const renderer = await renderForId('todo-1')

    const promoteBtns = findByTestId(renderer, 'promote-btn')
    act(() => { promoteBtns[0].props.onClick() })

    // No verdict selected — confirm button disabled
    const confirmBtns = findByTestId(renderer, 'promote-confirm-btn')
    expect(confirmBtns.length).toBeGreaterThan(0)
    expect(confirmBtns[0].props.disabled).toBe(true)
  })
})
