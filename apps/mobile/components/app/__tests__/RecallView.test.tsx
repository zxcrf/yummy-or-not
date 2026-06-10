/* ============================================================
   Regression tests — RecallView multi-result search and warn styling.

   Pinned behaviors:
   - Replaces the old items.find() single-match with searchTastes multi-result.
   - Top match gets the big verdict card; additional matches appear under
     "Other matches" group.
   - warnBeforeBuy + warningsEnabled → warn styling on the card header.
   - warningsEnabled=false → no warn styling even when warnBeforeBuy=true.
   ============================================================ */

import TestRenderer, { act } from 'react-test-renderer'
import RecallView from '../RecallView'

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
