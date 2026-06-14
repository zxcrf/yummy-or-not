/* ============================================================
   Regression tests — AddModal A2 to-taste mode.
   Pins:
   1. todo mode enables Save with name only (no verdict required).
   2. tasted mode keeps verdict required.
   3. Save in todo mode posts status:'todo' and no verdict.
   4. Red warn-banner variant hidden in todo mode; yellow dup banner stays.
   ============================================================ */

import TestRenderer, { act } from 'react-test-renderer'
import AsyncStorage from '@react-native-async-storage/async-storage'
import AddModal from '../AddModal'

// ---- mock react-native ----------------------------------------------------

jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native')
  return new Proxy(actual, {
    get(target, prop, receiver) {
      if (prop === 'KeyboardAvoidingView') {
        return ({ children }: { children: React.ReactNode }) => children
      }
      if (prop === 'ScrollView') {
        return ({ children }: { children: React.ReactNode }) => (
          <div>{children}</div>
        )
      }
      return Reflect.get(target, prop, receiver)
    },
  })
})

// ---- mock shared ----------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockCreateTaste = jest.fn<any, any[]>()
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockSearchTastes = jest.fn<any, any[]>(() => [])
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockCreateTag = jest.fn<any, any[]>()
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockReverseGeocode = jest.fn<any, any[]>()

jest.mock('@yon/shared', () => ({
  TAG_CHOICES: ['Coffee', 'Boba'],
  createTaste: (a: unknown) => mockCreateTaste(a),
  createTag: (a: unknown) => mockCreateTag(a),
  reverseGeocode: (a: unknown, b: unknown) => mockReverseGeocode(a, b),
  searchTastes: (a: unknown) => mockSearchTastes(a),
}))

// ---- mock _useTastes / _useTags -------------------------------------------

jest.mock('@/app/(tabs)/_useTastes', () => ({
  invalidateTastes: jest.fn(),
  useRefreshableTastes: () => ({ items: [] }),
}))

jest.mock('@/app/(tabs)/_useTags', () => ({
  invalidateTagsCache: jest.fn(),
  useTags: () => ({ tags: [] }),
}))

// ---- mock providers -------------------------------------------------------

jest.mock('@/providers/I18nProvider', () => ({
  useI18n: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        log_taste: 'Log a taste',
        cancel: 'Cancel',
        add_mode_tasted: 'I ate it',
        add_mode_todo: 'Want to try',
        how_was_it: 'How was it?',
        save_taste_web: 'Save',
        add_photo: 'Add photo',
        f_what: 'What?',
        f_what_todo: 'Want to try?',
        f_where: 'Where?',
        f_price: 'Price',
        tags: 'Tags',
        add_tag: 'Add tag',
        your_take: 'Your take',
        v_yum: 'YUM', v_meh: 'MEH', v_nah: 'NAH',
        add_duplicate_hint: 'You logged this before',
        add_warn_hint: 'You said skip it',
      }
      return map[key] ?? key
    },
  }),
}))

jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({ user: { warningsEnabled: true, locationEnabled: false } }),
}))

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
}))

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 47, bottom: 0, left: 0, right: 0 }),
}))

jest.mock('expo-image-picker', () => ({}))
jest.mock('expo-location', () => ({}))
jest.mock('expo-image-manipulator', () => ({}))
jest.mock('react-native-reanimated', () => ({
  FadeIn: { duration: () => ({}) },
  FadeOut: { duration: () => ({}) },
  default: { View: ({ children }: { children: React.ReactNode }) => children },
}))

// ---- mock ds components ---------------------------------------------------

jest.mock('@/components/ds', () => ({
  Button: ({ children, onPress, disabled, testID }: {
    children: React.ReactNode; onPress?: () => void; disabled?: boolean; testID?: string
  }) => (
    <button onClick={onPress} disabled={disabled} data-testid={testID}>{children}</button>
  ),
  Icon: ({ name }: { name: string }) => <span data-icon={name} />,
  IconButton: ({ children, onPress }: { children: React.ReactNode; onPress?: () => void }) => (
    <button onClick={onPress}>{children}</button>
  ),
  Input: ({ value, onChangeText, label, testID }: {
    value: string; onChangeText?: (t: string) => void; label?: string; testID?: string
  }) => {
    const { TextInput } = require('react-native')
    return (
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        testID={testID}
      />
    )
  },
  Tag: ({ children, active, onPress }: {
    children: React.ReactNode; active?: boolean; onPress?: () => void
  }) => (
    <span data-active={active} onClick={onPress}>{children}</span>
  ),
  Textarea: ({ value, onChangeText }: { value: string; onChangeText?: (t: string) => void }) => (
    <textarea value={value} onChange={(e) => onChangeText?.(e.target.value)} />
  ),
  VerdictPicker: ({ value, onChange }: {
    value: string | null; onChange: (v: string) => void
  }) => (
    <div data-testid="verdict-picker" data-value={value}>
      {(['yum', 'meh', 'nah'] as const).map((v) => (
        <button key={v} data-verdict={v} onClick={() => onChange(v)}>{v}</button>
      ))}
    </div>
  ),
  VerdictStamp: ({ verdict }: { verdict: string }) => <span data-verdict={verdict} />,
}))

jest.mock('../PhotoPreview', () => ({
  PhotoPreview: () => null,
}))

// ---- helpers --------------------------------------------------------------

// Tracks the most recently rendered modal so afterEach can unmount it. The
// unmount fires AddModal's cleanup effect, which clears the 500ms same-name
// debounce timer — otherwise a pending real timer fires setDebouncedName after
// the test completes ("update not wrapped in act"), surfacing as an uncaught
// error that fails the run on slower CI.
let currentRenderer: TestRenderer.ReactTestRenderer | null = null

function renderModal() {
  const onClose = jest.fn()
  const onSaved = jest.fn()
  let renderer!: TestRenderer.ReactTestRenderer
  act(() => {
    renderer = TestRenderer.create(<AddModal onClose={onClose} onSaved={onSaved} />)
  })
  currentRenderer = renderer
  return { renderer, onClose, onSaved }
}

function findAllText(renderer: TestRenderer.ReactTestRenderer, text: string) {
  return renderer.root.findAll(
    (n) => String(n.type) === 'Text' && n.props.children === text,
  )
}

function findSaveButton(renderer: TestRenderer.ReactTestRenderer) {
  return renderer.root.findAll(
    (n) =>
      (String(n.type) === 'button' || String(n.type) === 'Button') &&
      n.props.children === 'Save',
  )
}

function findTodoBtnNode(renderer: TestRenderer.ReactTestRenderer) {
  return renderer.root.findAll(
    (n) => n.props['data-testid'] === 'add-mode-todo-btn' || n.props.testID === 'add-mode-todo-btn',
  )
}

// ---- tests ----------------------------------------------------------------

describe('AddModal A2 — to-taste mode', () => {
  beforeEach(async () => {
    jest.clearAllMocks()
    mockCreateTaste.mockResolvedValue({ id: 'new-id' })
    // Isolate the AddModal draft store: AddModal autosaves an in-progress entry
    // to AsyncStorage and flushes it on unmount, so without clearing, a draft
    // left by one test would be restored into the next test's mount (firing
    // state updates outside act). Clear before and after each test.
    await AsyncStorage.clear()
  })

  afterEach(async () => {
    act(() => {
      currentRenderer?.unmount()
    })
    currentRenderer = null
    await AsyncStorage.clear()
  })

  it('defaults to tasted mode — Save button disabled without verdict', () => {
    const { renderer } = renderModal()

    // Save button present but disabled (no name, no verdict)
    const saveButtons = findSaveButton(renderer)
    expect(saveButtons.length).toBeGreaterThan(0)
    expect(saveButtons[0].props.disabled).toBe(true)
  })

  it('todo mode renders — mode selector shows both options', () => {
    const { renderer } = renderModal()

    // Both mode labels are present in the tree
    expect(findAllText(renderer, 'I ate it').length).toBeGreaterThan(0)
    expect(findAllText(renderer, 'Want to try').length).toBeGreaterThan(0)
  })

  it('title field asks "what to try" in todo mode, "what you ate" in tasted mode', () => {
    const { renderer } = renderModal()

    // Default tasted mode: the name field uses the f_what label.
    expect(
      renderer.root.findAll((n) => n.props['accessibilityLabel'] === 'What?'),
    ).not.toHaveLength(0)
    expect(
      renderer.root.findAll((n) => n.props['accessibilityLabel'] === 'Want to try?'),
    ).toHaveLength(0)

    // Switch to todo mode — the label flips to f_what_todo (user hasn't eaten it).
    const todoBtn = findTodoBtnNode(renderer)
    act(() => { todoBtn[0].props.onPress() })

    expect(
      renderer.root.findAll((n) => n.props['accessibilityLabel'] === 'Want to try?'),
    ).not.toHaveLength(0)
    expect(
      renderer.root.findAll((n) => n.props['accessibilityLabel'] === 'What?'),
    ).toHaveLength(0)
  })

  it('todo mode: Save enabled with name only (no verdict required)', async () => {
    const { renderer } = renderModal()

    // Switch to todo mode
    const todoBtn = findTodoBtnNode(renderer)
    expect(todoBtn.length).toBeGreaterThan(0)
    act(() => {
      todoBtn[0].props.onPress()
    })

    // Type a name — in todo mode the title field uses the f_what_todo label
    const nameInput = renderer.root.findAll(
      (n) => n.props['accessibilityLabel'] === 'Want to try?',
    )
    expect(nameInput.length).toBeGreaterThan(0)
    act(() => {
      nameInput[0].props.onChangeText('Matcha Latte')
    })

    // VerdictPicker should NOT be in the tree in todo mode
    const verdictPickers = renderer.root.findAll(
      (n) => n.props['data-testid'] === 'verdict-picker',
    )
    expect(verdictPickers).toHaveLength(0)

    // Save button should be enabled now
    const saveButtons = findSaveButton(renderer)
    expect(saveButtons.length).toBeGreaterThan(0)
    expect(saveButtons[0].props.disabled).toBe(false)
  })

  it('todo mode: Save posts status:todo and no verdict', async () => {
    const { renderer, onSaved } = renderModal()

    // Switch to todo mode
    const todoBtn = findTodoBtnNode(renderer)
    act(() => { todoBtn[0].props.onPress() })

    // Type a name — todo mode uses the f_what_todo label
    const nameInput = renderer.root.findAll(
      (n) => n.props['accessibilityLabel'] === 'Want to try?',
    )
    act(() => {
      nameInput[0].props.onChangeText('Matcha Latte')
    })

    // Press Save
    const saveButtons = findSaveButton(renderer)
    await act(async () => {
      saveButtons[0].props.onClick()
    })

    expect(mockCreateTaste).toHaveBeenCalledTimes(1)
    const [input] = mockCreateTaste.mock.calls[0]
    expect(input.status).toBe('todo')
    expect(input.verdict).toBeUndefined()
    expect(input.name).toBe('Matcha Latte')
    expect(onSaved).toHaveBeenCalledWith('new-id')
  })

  it('tasted mode: Save stays disabled without verdict even with name', () => {
    const { renderer } = renderModal()

    // Default tasted mode — type name only
    const nameInput = renderer.root.findAll(
      (n) => n.props['accessibilityLabel'] === 'What?',
    )
    act(() => {
      nameInput[0].props.onChangeText('Espresso')
    })

    const saveButtons = findSaveButton(renderer)
    expect(saveButtons[0].props.disabled).toBe(true)
  })

  it('tasted mode: red warn banner hidden when switching to todo', async () => {
    // Set up a matching item with warnBeforeBuy
    mockSearchTastes.mockReturnValue([{
      strength: 'exact',
      item: { id: 'x', name: 'Matcha', warnBeforeBuy: true, verdict: 'nah' as const, status: 'tasted' as const, tags: [], boughtCount: 0, purchases: [], date: '', notes: '', image: '', imageThumb: '', imageDisplay: '', imageKey: '', createdAt: '', place: '', price: '' },
    }])

    const { renderer } = renderModal()

    // Type name (debounce fires immediately in test via jest fake timer or just act)
    const nameInput = renderer.root.findAll(
      (n) => n.props['accessibilityLabel'] === 'What?',
    )
    act(() => {
      nameInput[0].props.onChangeText('Matcha')
    })

    // Switch to todo mode
    const todoBtn = findTodoBtnNode(renderer)
    act(() => { todoBtn[0].props.onPress() })

    // No red 'warn' banner — VerdictStamp for warn should not exist
    // (the dup-banner variant for warn is suppressed in todo mode)
    const warnBanners = renderer.root.findAll(
      (n) => n.props['testID'] === 'dup-banner' && n.props['backgroundColor'] === '$verdictNah',
    )
    expect(warnBanners).toHaveLength(0)
  })
})
