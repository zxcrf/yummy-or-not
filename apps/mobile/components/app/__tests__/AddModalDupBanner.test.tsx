/* ============================================================
   Regression tests — AddModal same-name detection (dup banner).

   Pinned behaviors:
   - Debounce: banner does NOT appear immediately on keypress; appears
     after 500 ms fake-timer advance (only exact/strong matches).
   - Weak matches produce no banner.
   - Plain duplicate (no warnBeforeBuy) → yellow 'dup' banner.
   - warnBeforeBuy + warningsEnabled=true → red 'warn' banner.
   - warningsEnabled=false → yellow 'dup' banner even if warnBeforeBuy.
   - Dismiss (X tap) removes the banner and the prefix is remembered for
     the session so re-typing the same name does not reshow it.
   - Banner is inline in the scroll view, not a modal/dialog.
   ============================================================ */

import TestRenderer, { act } from 'react-test-renderer'
import { Platform } from 'react-native'
import AddModal from '../AddModal'

// ---- stable taste factory -----------------------------------------------

function taste(overrides: Partial<{
  id: string; name: string; place: string; verdict: string;
  warnBeforeBuy: boolean;
}>): Record<string, unknown> {
  return {
    id: 'id-1', name: 'Matcha latte', place: 'Starbucks',
    verdict: 'yum', warnBeforeBuy: false, date: '2d',
    imageThumb: '', image: '', imageKey: '', notes: '', tags: [],
    boughtCount: 1, price: '', purchases: [], createdAt: '', imageDisplay: '',
    ...overrides,
  }
}

// ---- mocks ---------------------------------------------------------------

const mockSearchTastes = jest.fn()
const mockCreateTaste = jest.fn()
const mockCreateTag = jest.fn()

jest.mock('@yon/shared', () => ({
  TAG_CHOICES: ['Boba', 'Coffee'],
  createTaste: (...args: unknown[]) => mockCreateTaste(...args),
  createTag: (...args: unknown[]) => mockCreateTag(...args),
  searchTastes: (...args: unknown[]) => mockSearchTastes(...args),
}))

jest.mock('@/app/(tabs)/_useTastes', () => ({
  invalidateTastes: jest.fn(async () => []),
  useRefreshableTastes: () => ({ items: mockItems, refresh: jest.fn() }),
}))

jest.mock('@/app/(tabs)/_useTasters', () => ({
  useTasters: () => ({ tasters: [], loading: false }),
}))

// Self taster (null). Mocked so the real hook's async listener never fires a
// setState after the suite tears down (act-warning leak → Linux CI exit-1).
jest.mock('@/app/(tabs)/_useActiveTaster', () => ({
  useActiveTaster: () => null,
}))

jest.mock('@/app/(tabs)/_useTags', () => ({
  useTags: () => ({ tags: [], loading: false }),
  invalidateTagsCache: jest.fn(),
  clearTagsCache: jest.fn(),
}))

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}))

jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}))

jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: jest.fn(),
  SaveFormat: { JPEG: 'jpeg' },
}))

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
}))

let mockWarningsEnabled = true
jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({ user: { warningsEnabled: mockWarningsEnabled } }),
}))

jest.mock('@/providers/I18nProvider', () => ({
  useI18n: () => ({
    t: (key: string) => ({
      add_photo: 'Add a photo',
      add_tag: 'Add tag',
      cancel: 'Cancel',
      f_price: 'Price',
      f_what: 'What did you have?',
      f_where: 'Where?',
      how_was_it: 'How was it?',
      log_taste: 'Log a taste',
      photo_permission_denied: 'Photo access is needed.',
      save_taste_web: 'Save taste',
      tag_placeholder: 'New tag',
      tags: 'Tags',
      v_meh: 'MEH', v_nah: 'NAH', v_yum: 'YUM',
      your_take: 'Your take',
      add_duplicate_hint: "You've logged this before",
      add_warn_hint: 'You said skip it last time',
    }[key] ?? key),
  }),
}))

// ---- module-level mutable items list ------------------------------------

let mockItems: Array<Record<string, unknown>> = []

// ---- render helper -------------------------------------------------------

function renderAddModal() {
  let renderer!: TestRenderer.ReactTestRenderer
  act(() => {
    renderer = TestRenderer.create(
      <AddModal onClose={() => {}} onSaved={() => {}} />,
    )
  })
  return renderer
}

/** Find nodes by testID. Returns deduplicated by fiber identity. */
function nodesByTestId(renderer: TestRenderer.ReactTestRenderer, testID: string) {
  // findAll walks the full fiber tree; tamagui View propagates testID to a
  // native View child — both carry the same prop. We deduplicate by taking
  // only nodes whose direct parent does NOT also carry the same testID,
  // so we get exactly the authored element count.
  const all = renderer.root.findAll((n) => n.props.testID === testID)
  return all.filter((n) => !n.parent || n.parent.props.testID !== testID)
}

function textNodes(renderer: TestRenderer.ReactTestRenderer, text: string) {
  return renderer.root.findAll(
    (n) =>
      String(n.type) === 'Text' &&
      typeof n.props.children === 'string' &&
      n.props.children === text,
  )
}

// ---- tests ---------------------------------------------------------------

describe('AddModal — same-name detection banner', () => {
  const realOS = Platform.OS

  beforeEach(() => {
    jest.useFakeTimers()
    jest.clearAllMocks()
    mockWarningsEnabled = true
    mockItems = []
    mockSearchTastes.mockReturnValue([])
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' })
  })

  afterEach(() => {
    jest.useRealTimers()
    Object.defineProperty(Platform, 'OS', { configurable: true, value: realOS })
  })

  it('does NOT show banner immediately after typing (debounce)', () => {
    const match = taste({ id: 'a', name: 'Matcha latte' })
    mockItems = [match]
    mockSearchTastes.mockReturnValue([
      { item: match, score: 10001, strength: 'exact' },
    ])

    const renderer = renderAddModal()
    const nameField = renderer.root.findByProps({ placeholder: 'Brown sugar boba' })

    act(() => { nameField.props.onChangeText('Matcha latte') })

    // Banner must NOT be present before the 500ms debounce fires.
    expect(nodesByTestId(renderer, 'dup-banner')).toHaveLength(0)
  })

  it('shows banner after 500 ms debounce for an exact/strong match', () => {
    const match = taste({ id: 'b', name: 'Matcha latte' })
    mockItems = [match]
    mockSearchTastes.mockReturnValue([
      { item: match, score: 10001, strength: 'exact' },
    ])

    const renderer = renderAddModal()
    const nameField = renderer.root.findByProps({ placeholder: 'Brown sugar boba' })

    act(() => { nameField.props.onChangeText('Matcha latte') })
    act(() => { jest.advanceTimersByTime(500) })

    expect(nodesByTestId(renderer, 'dup-banner')).toHaveLength(1)
    expect(textNodes(renderer, "You've logged this before")).toHaveLength(1)
  })

  it('does NOT show banner for weak matches only', () => {
    const match = taste({ id: 'c', name: 'Matcha drink' })
    mockItems = [match]
    // Only weak result — below exact/strong threshold
    mockSearchTastes.mockReturnValue([
      { taste: match, score: 5, strength: 'weak' },
    ])

    const renderer = renderAddModal()
    const nameField = renderer.root.findByProps({ placeholder: 'Brown sugar boba' })

    act(() => { nameField.props.onChangeText('Matcha') })
    act(() => { jest.advanceTimersByTime(500) })

    expect(nodesByTestId(renderer, 'dup-banner')).toHaveLength(0)
  })

  it('shows red warn banner when warnBeforeBuy=true and warningsEnabled=true', () => {
    const match = taste({ id: 'd', name: 'Matcha latte', warnBeforeBuy: true, verdict: 'nah' })
    mockItems = [match]
    mockWarningsEnabled = true
    mockSearchTastes.mockReturnValue([
      { item: match, score: 10001, strength: 'exact' },
    ])

    const renderer = renderAddModal()
    const nameField = renderer.root.findByProps({ placeholder: 'Brown sugar boba' })

    act(() => { nameField.props.onChangeText('Matcha latte') })
    act(() => { jest.advanceTimersByTime(500) })

    expect(nodesByTestId(renderer, 'dup-banner')).toHaveLength(1)
    expect(textNodes(renderer, 'You said skip it last time')).toHaveLength(1)
  })

  it('shows yellow dup banner (not red) when warningsEnabled=false even if warnBeforeBuy=true', () => {
    const match = taste({ id: 'e', name: 'Matcha latte', warnBeforeBuy: true, verdict: 'nah' })
    mockItems = [match]
    mockWarningsEnabled = false
    mockSearchTastes.mockReturnValue([
      { item: match, score: 10001, strength: 'exact' },
    ])

    const renderer = renderAddModal()
    const nameField = renderer.root.findByProps({ placeholder: 'Brown sugar boba' })

    act(() => { nameField.props.onChangeText('Matcha latte') })
    act(() => { jest.advanceTimersByTime(500) })

    expect(nodesByTestId(renderer, 'dup-banner')).toHaveLength(1)
    // Should show dup text, not warn text
    expect(textNodes(renderer, "You've logged this before")).toHaveLength(1)
    expect(textNodes(renderer, 'You said skip it last time')).toHaveLength(0)
  })

  it('dismiss (X) removes the banner', () => {
    const match = taste({ id: 'f', name: 'Boba tea' })
    mockItems = [match]
    mockSearchTastes.mockReturnValue([
      { item: match, score: 10001, strength: 'exact' },
    ])

    const renderer = renderAddModal()
    const nameField = renderer.root.findByProps({ placeholder: 'Brown sugar boba' })

    act(() => { nameField.props.onChangeText('Boba tea') })
    act(() => { jest.advanceTimersByTime(500) })
    expect(nodesByTestId(renderer, 'dup-banner')).toHaveLength(1)

    // Find the close button inside the banner and press it
    const banner = nodesByTestId(renderer, 'dup-banner')[0]
    const closeButtons = banner.findAll(
      (n) => typeof n.props.accessibilityLabel === 'string' && n.props.accessibilityLabel === 'Cancel',
    )
    expect(closeButtons.length).toBeGreaterThan(0)
    act(() => { closeButtons[0].props.onPress?.() })

    expect(nodesByTestId(renderer, 'dup-banner')).toHaveLength(0)
  })

  it('dismissed prefix is remembered — same query does not reshow banner', () => {
    const match = taste({ id: 'g', name: 'Cold brew' })
    mockItems = [match]
    mockSearchTastes.mockReturnValue([
      { item: match, score: 10001, strength: 'exact' },
    ])

    const renderer = renderAddModal()
    const nameField = renderer.root.findByProps({ placeholder: 'Brown sugar boba' })

    // Show then dismiss
    act(() => { nameField.props.onChangeText('Cold brew') })
    act(() => { jest.advanceTimersByTime(500) })
    expect(nodesByTestId(renderer, 'dup-banner')).toHaveLength(1)

    const banner = nodesByTestId(renderer, 'dup-banner')[0]
    const closeButtons = banner.findAll(
      (n) => typeof n.props.accessibilityLabel === 'string' && n.props.accessibilityLabel === 'Cancel',
    )
    act(() => { closeButtons[0].props.onPress?.() })
    expect(nodesByTestId(renderer, 'dup-banner')).toHaveLength(0)

    // Clear name then retype the same value
    act(() => { nameField.props.onChangeText('') })
    act(() => { jest.advanceTimersByTime(500) })
    act(() => { nameField.props.onChangeText('Cold brew') })
    act(() => { jest.advanceTimersByTime(500) })

    // Must NOT reshow — the prefix was dismissed
    expect(nodesByTestId(renderer, 'dup-banner')).toHaveLength(0)
  })

  it('banner is inline in the form (not a modal/dialog)', () => {
    const match = taste({ id: 'h', name: 'Matcha' })
    mockItems = [match]
    mockSearchTastes.mockReturnValue([
      { item: match, score: 10001, strength: 'exact' },
    ])

    const renderer = renderAddModal()
    const nameField = renderer.root.findByProps({ placeholder: 'Brown sugar boba' })

    act(() => { nameField.props.onChangeText('Matcha') })
    act(() => { jest.advanceTimersByTime(500) })

    // No Modal component anywhere in the tree
    const modals = renderer.root.findAll(
      (n) => String(n.type) === 'Modal' || n.props.role === 'dialog',
    )
    expect(modals).toHaveLength(0)

    // Banner is present inline
    expect(nodesByTestId(renderer, 'dup-banner')).toHaveLength(1)
  })

  it('dismissed prefix suppresses banner when typing further chars (prefix-startsWith fix)', () => {
    // Dismiss at "珍珠", then type "珍珠奶" — banner must not reappear.
    const match = taste({ id: 'j', name: '珍珠奶茶' })
    mockItems = [match]
    mockSearchTastes.mockReturnValue([
      { item: match, score: 10001, strength: 'exact' },
    ])

    const renderer = renderAddModal()
    const nameField = renderer.root.findByProps({ placeholder: 'Brown sugar boba' })

    // Type short prefix and show banner
    act(() => { nameField.props.onChangeText('珍珠') })
    act(() => { jest.advanceTimersByTime(500) })
    expect(nodesByTestId(renderer, 'dup-banner')).toHaveLength(1)

    // Dismiss
    const banner = nodesByTestId(renderer, 'dup-banner')[0]
    const closeBtn = banner.findAll(
      (n) => typeof n.props.accessibilityLabel === 'string' && n.props.accessibilityLabel === 'Cancel',
    )
    act(() => { closeBtn[0].props.onPress?.() })
    expect(nodesByTestId(renderer, 'dup-banner')).toHaveLength(0)

    // Type a longer query that extends the dismissed prefix
    act(() => { nameField.props.onChangeText('珍珠奶') })
    act(() => { jest.advanceTimersByTime(500) })

    // Banner must NOT reappear — the dismissed prefix covers this extension
    expect(nodesByTestId(renderer, 'dup-banner')).toHaveLength(0)
  })

  it('does not show banner when query is too short (latin < 3 chars)', () => {
    const match = taste({ id: 'i', name: 'AB drink' })
    mockItems = [match]
    mockSearchTastes.mockReturnValue([
      { item: match, score: 10001, strength: 'exact' },
    ])

    const renderer = renderAddModal()
    const nameField = renderer.root.findByProps({ placeholder: 'Brown sugar boba' })

    act(() => { nameField.props.onChangeText('AB') })
    act(() => { jest.advanceTimersByTime(500) })

    // searchTastes should not even be called for too-short queries
    // (queryMeetsMinLength returns false, so dupMatches stays [])
    // The banner must not appear.
    expect(nodesByTestId(renderer, 'dup-banner')).toHaveLength(0)
  })
})
