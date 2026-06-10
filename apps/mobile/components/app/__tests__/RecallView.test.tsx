/* ============================================================
   Regression tests — RecallView multi-result search, warn styling,
   and viewport-adaptive recent card count.
   ============================================================ */

import TestRenderer, { act } from 'react-test-renderer'
import RecallView, { recentCardCount } from '../RecallView'
import { en } from '../../../../../packages/shared/src/i18n/locales/en'
import { zh } from '../../../../../packages/shared/src/i18n/locales/zh'

// ---- mock react-native (useWindowDimensions) ----------------------------

const mockWindowDimensions = jest.fn(() => ({ width: 390, height: 744, scale: 2, fontScale: 2 }))

jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native')
  return new Proxy(actual, {
    get(target, prop, receiver) {
      if (prop === 'useWindowDimensions') return () => mockWindowDimensions()
      return Reflect.get(target, prop, receiver)
    },
  })
})

// ---- mock shared --------------------------------------------------------

const mockSearchTastes = jest.fn()

jest.mock('@yon/shared', () => ({
  searchTastes: (...args: unknown[]) => mockSearchTastes(...args),
}))

// ---- mock _useTastes ----------------------------------------------------

let mockItems: Array<Record<string, unknown>> = []
jest.mock('@/app/(tabs)/_useTastes', () => ({
  useRefreshableTastes: () => ({ items: mockItems, refresh: jest.fn() }),
}))

// ---- mock useAuth -------------------------------------------------------

let mockUser: { warningsEnabled: boolean } | null = { warningsEnabled: true }
jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({ user: mockUser }),
}))

// ---- mock expo-router ---------------------------------------------------

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
}))

// ---- mock i18n ----------------------------------------------------------

jest.mock('@/providers/I18nProvider', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) => {
      const map: Record<string, string> = {
        recall_title: 'Tasted it before?',
        recall_sub: 'Search before you spend.',
        recall_placeholder: 'Try matcha…',
        recently_recalled: 'Recently recalled',
        verdict_on_file: 'Verdict on file',
        loved_it: 'You loved it',
        soso: 'It was so-so',
        skip_it: 'You said skip it',
        no_record: params ? `No record of "${params.q}".` : 'No record.',
        try_then_log: 'Try it, then log.',
        log_it_now: 'Log it now',
        recall_other_matches: 'Other matches',
        recall_warn_skip: 'You marked this ×_× NAH last time — skip it',
        v_yum: 'YUM', v_meh: 'MEH', v_nah: 'NAH',
      }
      return map[key] ?? key
    },
  }),
}))

// ---- mock ds components -------------------------------------------------

jest.mock('@/components/ds', () => ({
  Button: ({ children, onPress }: { children: React.ReactNode; onPress?: () => void }) => (
    <button onClick={onPress}>{children}</button>
  ),
  Card: ({ children, variant, padded }: { children: React.ReactNode; variant?: string; padded?: boolean }) => (
    <div data-variant={variant} data-padded={padded}>{children}</div>
  ),
  Icon: ({ name }: { name: string }) => <span data-icon={name} />,
  Input: ({ value, onChangeText, placeholder, ...rest }: { value: string; onChangeText: (t: string) => void; placeholder?: string; [k: string]: unknown }) => (
    <input value={value} onChange={(e) => onChangeText(e.target.value)} placeholder={placeholder} />
  ),
  VerdictStamp: ({ verdict, label }: { verdict: string; label: string }) => (
    <span data-verdict={verdict}>{label}</span>
  ),
}))

// ---- mock expo-image ----------------------------------------------------

jest.mock('expo-image', () => ({ Image: () => null }))

// ---- helpers ------------------------------------------------------------

function taste(overrides: Partial<{
  id: string; name: string; place: string; verdict: string;
  warnBeforeBuy: boolean; date: string; imageThumb: string;
  image: string; imageKey: string;
}>): Record<string, unknown> {
  return {
    id: 'id-1', name: 'Matcha latte', place: 'Starbucks',
    verdict: 'yum', warnBeforeBuy: false, date: '2 days ago',
    imageThumb: '', image: '', imageKey: '', notes: '', tags: [],
    boughtCount: 1, price: '', purchases: [], createdAt: '', imageDisplay: '',
    ...overrides,
  }
}

function renderRecallView() {
  let renderer!: TestRenderer.ReactTestRenderer
  act(() => {
    renderer = TestRenderer.create(<RecallView />)
  })
  return renderer
}

function textNodes(renderer: TestRenderer.ReactTestRenderer, text: string) {
  return renderer.root.findAll(
    (node) =>
      String(node.type) === 'Text' &&
      typeof node.props.children === 'string' &&
      node.props.children === text,
  )
}

// ---- tests --------------------------------------------------------------

describe('RecallView', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockUser = { warningsEnabled: true }
    mockItems = []
    mockSearchTastes.mockReturnValue([])
  })

  it('shows recently-recalled list when query is empty', () => {
    const item = taste({ id: 'a', name: 'Boba' })
    mockItems = [item as never]

    const renderer = renderRecallView()
    expect(textNodes(renderer, 'Recently recalled')).toHaveLength(1)
    expect(mockSearchTastes).not.toHaveBeenCalled()
  })

  it('regression: shows ALL results above threshold (not just first find())', () => {
    // This was the bug: items.find() returned only the first substring match.
    // Now searchTastes returns ranked scored results and we show all of them.
    const top = taste({ id: 'top', name: 'Matcha latte', verdict: 'yum' })
    const second = taste({ id: 'sec', name: 'Matcha smoothie', verdict: 'meh' })
    mockItems = [top, second] as never[]
    mockSearchTastes.mockReturnValue([
      { item: top, score: 10001, strength: 'exact' },
      { item: second, score: 1001, strength: 'strong' },
    ])

    const renderer = renderRecallView()
    // Simulate typing in the search box
    const input = renderer.root.findByProps({ placeholder: 'Try matcha…' })
    act(() => { input.props.onChangeText('matcha') })

    // Top result verdict card header
    expect(textNodes(renderer, 'Verdict on file')).toHaveLength(1)
    expect(textNodes(renderer, 'You loved it')).toHaveLength(1)

    // "Other matches" section header
    expect(textNodes(renderer, 'Other matches')).toHaveLength(1)

    // Second match name must appear somewhere in the tree
    const secondNames = renderer.root.findAll(
      (n) => String(n.type) === 'Text' && n.props.children === 'Matcha smoothie',
    )
    expect(secondNames.length).toBeGreaterThan(0)
  })

  it('shows warn styling on top result card when warnBeforeBuy=true and warningsEnabled=true', () => {
    const warnTaste = taste({ id: 'w1', name: 'Matcha', verdict: 'nah', warnBeforeBuy: true })
    mockItems = [warnTaste] as never[]
    mockSearchTastes.mockReturnValue([
      { item: warnTaste, score: 10001, strength: 'exact' },
    ])
    mockUser = { warningsEnabled: true }

    const renderer = renderRecallView()
    const input = renderer.root.findByProps({ placeholder: 'Try matcha…' })
    act(() => { input.props.onChangeText('matcha') })

    // Warn banner text must appear, not the normal verdict label
    expect(textNodes(renderer, 'You marked this ×_× NAH last time — skip it')).toHaveLength(1)
    // The normal "You said skip it" label must NOT appear in the card header
    // (it can still appear in the row stamp, but the big headline is replaced)
    const skipItHeaderNodes = renderer.root.findAll(
      (n) =>
        String(n.type) === 'Text' &&
        n.props.children === 'You said skip it' &&
        n.props.fontSize >= 40,
    )
    expect(skipItHeaderNodes).toHaveLength(0)
  })

  it('shows plain verdict (no warn styling) when warningsEnabled=false even if warnBeforeBuy=true', () => {
    const warnTaste = taste({ id: 'w2', name: 'Matcha', verdict: 'nah', warnBeforeBuy: true })
    mockItems = [warnTaste] as never[]
    mockSearchTastes.mockReturnValue([
      { item: warnTaste, score: 10001, strength: 'exact' },
    ])
    mockUser = { warningsEnabled: false }

    const renderer = renderRecallView()
    const input = renderer.root.findByProps({ placeholder: 'Try matcha…' })
    act(() => { input.props.onChangeText('matcha') })

    // Warn text must NOT appear
    expect(textNodes(renderer, 'You marked this ×_× NAH last time — skip it')).toHaveLength(0)
    // Normal verdict label must appear
    expect(textNodes(renderer, 'You said skip it')).toHaveLength(1)
  })

  it('shows no-record state when searchTastes returns empty', () => {
    mockItems = []
    mockSearchTastes.mockReturnValue([])

    const renderer = renderRecallView()
    const input = renderer.root.findByProps({ placeholder: 'Try matcha…' })
    act(() => { input.props.onChangeText('xyz') })

    expect(textNodes(renderer, 'No record of "xyz".')).toHaveLength(1)
    // Button renders as a native pressable — find it by its children string
    const logItButtons = renderer.root.findAll(
      (n) => n.props.children === 'Log it now',
    )
    expect(logItButtons.length).toBeGreaterThan(0)
  })

  it('does NOT show "Other matches" section when there is only one result', () => {
    const single = taste({ id: 's1', name: 'Boba' })
    mockItems = [single] as never[]
    mockSearchTastes.mockReturnValue([
      { item: single, score: 10001, strength: 'exact' },
    ])

    const renderer = renderRecallView()
    const input = renderer.root.findByProps({ placeholder: 'Try matcha…' })
    act(() => { input.props.onChangeText('boba') })

    expect(textNodes(renderer, 'Other matches')).toHaveLength(0)
  })
})

function rowCount(renderer: TestRenderer.ReactTestRenderer): number {
  return renderer.root.findAll((node) => (node.type as unknown) === 'VerdictStamp').length
}

function renderRecallViewAt(height: number): TestRenderer.ReactTestRenderer {
  mockWindowDimensions.mockReturnValue({ width: 390, height, scale: 2, fontScale: 2 })
  let renderer!: TestRenderer.ReactTestRenderer
  act(() => {
    renderer = TestRenderer.create(<RecallView />)
  })
  return renderer
}

describe('recentCardCount', () => {
  it('clamps short viewports to 3 rows', () => {
    expect(recentCardCount(480)).toBe(3)
    expect(recentCardCount(0)).toBe(3)
    expect(recentCardCount(-1)).toBe(3)
    expect(recentCardCount(Number.NaN)).toBe(3)
  })

  it('returns a typical phone count around 4 to 5 rows', () => {
    expect(recentCardCount(744)).toBe(4)
    expect(recentCardCount(832)).toBe(5)
  })

  it('grows on tall screens and clamps at 8 rows', () => {
    expect(recentCardCount(920)).toBe(6)
    expect(recentCardCount(1400)).toBe(8)
    expect(recentCardCount(Number.POSITIVE_INFINITY)).toBe(8)
  })

  it('is monotonic non-decreasing across thresholds and edge cases', () => {
    const heights = [
      Number.NEGATIVE_INFINITY, Number.NaN, 0, 391, 392, 479, 480, 567, 568,
      655, 656, 743, 744, 831, 832, 919, 920, 1007, 1008, 1095, 1096, 1183,
      1184, Number.POSITIVE_INFINITY,
    ]
    const counts = heights.map((height) => recentCardCount(height))
    expect(counts).toEqual([3,3,3,3,3,3,3,3,3,3,3,3,4,4,5,5,6,6,7,7,8,8,8,8])
    for (let index = 1; index < counts.length; index += 1) {
      expect(counts[index]).toBeGreaterThanOrEqual(counts[index - 1]!)
    }
  })
})

describe('RecallView recent rows', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockUser = { warningsEnabled: true }
    mockSearchTastes.mockReturnValue([])
    mockItems = Array.from({ length: 10 }, (_, i) => ({
      id: `taste-${i + 1}`,
      name: `Taste ${i + 1}`,
      place: `Place ${i + 1}`,
      verdict: i % 3 === 0 ? 'nah' : i % 2 === 0 ? 'meh' : 'yum',
      warnBeforeBuy: false,
      date: 'today',
      imageThumb: '', image: '', imageKey: '', notes: '',
      tags: [], boughtCount: 1, price: '', purchases: [],
      createdAt: '2026-06-08T00:00:00.000Z', imageDisplay: '',
    }))
  })

  it('renders fewer recent rows on short screens and more on tall screens', () => {
    const shortRenderer = renderRecallViewAt(480)
    expect(rowCount(shortRenderer)).toBe(3)

    const tallRenderer = renderRecallViewAt(920)
    expect(rowCount(tallRenderer)).toBe(6)
  })
})

describe('library title locales', () => {
  it('keeps the renamed first-person titles in english and chinese', () => {
    expect(en.my_tastes).toBe('My Tastes')
    expect(zh.my_tastes).toBe('我的口味')
  })
})
