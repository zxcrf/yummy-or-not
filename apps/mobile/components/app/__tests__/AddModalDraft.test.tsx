/* ============================================================
   Regression test — AddModal draft autosave + close choice.

   User feedback (2026-06):
   1. "早上用 yummy 不小心按到取消的时候没有自动保存草稿，直接没有了" — a mis-tapped
      Cancel on the Add screen threw away everything typed.
   2. "关闭时给用户选择，是保存draft还是退出" — closing should let the user choose
      between keeping a draft and exiting.

   These tests pin the behavior:
   - Closing with unsaved content opens a save-or-exit choice instead of
     silently discarding (and onClose is NOT called yet).
   - Choosing "Save draft" persists the entry; the next open restores it.
   - Choosing "Discard" drops the entry; the next open is blank.
   - An empty form closes immediately, no choice sheet.
   - An uncontrolled exit (hardware back / swipe — the component unmounts
     without a choice) still autosaves, so nothing is lost (fixes feedback 1).
   - A successful save clears the draft so a saved entry never resurfaces.

   AsyncStorage uses the official jest mock (jest.setup), an in-memory store
   that persists across remounts within a test — exactly the cross-open
   persistence the draft relies on.
   ============================================================ */

import TestRenderer, { act } from 'react-test-renderer'
import { Platform } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import AddModal from '../AddModal'

const mockCreateTaste = jest.fn()

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

jest.mock('@yon/shared', () => ({
  TAG_CHOICES: ['Boba', 'Coffee'],
  createTaste: (...args: unknown[]) => mockCreateTaste(...args),
  createTag: jest.fn(),
  searchTastes: jest.fn().mockReturnValue([]),
}))

jest.mock('@/app/(tabs)/_useTastes', () => ({
  invalidateTastes: jest.fn(async () => []),
  useRefreshableTastes: () => ({ items: [], refresh: jest.fn() }),
}))

jest.mock('@/app/(tabs)/_useTasters', () => ({
  useTasters: () => ({ tasters: [], loading: false }),
}))

jest.mock('@/app/(tabs)/_useTags', () => ({
  useTags: () => ({ tags: [], loading: false }),
  invalidateTagsCache: jest.fn(),
  clearTagsCache: jest.fn(),
}))

// Self taster (null) — no persona switching in these tests.
jest.mock('@/app/(tabs)/_useActiveTaster', () => ({
  useActiveTaster: () => null,
}))

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
}))

// A concrete user id so the draft key is namespaced like production.
jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'u1', warningsEnabled: false } }),
}))

// t() returns the key, so we match on i18n keys directly.
jest.mock('@/providers/I18nProvider', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

const NAME_PLACEHOLDER = 'Brown sugar boba'

const mountedRenderers: TestRenderer.ReactTestRenderer[] = []

interface OpenOpts {
  onSaved?: (id: string) => void
  onClose?: () => void
}

/** Mount AddModal and let the initial draft-load (hydration) settle. */
async function openAddModal(opts: OpenOpts = {}): Promise<TestRenderer.ReactTestRenderer> {
  let renderer!: TestRenderer.ReactTestRenderer
  await act(async () => {
    renderer = TestRenderer.create(
      <AddModal
        onClose={opts.onClose ?? (() => {})}
        onSaved={opts.onSaved ?? (() => {})}
      />,
    )
  })
  mountedRenderers.push(renderer)
  await flush()
  return renderer
}

/** Flush pending microtasks (AsyncStorage mock resolves on the microtask queue). */
const flush = () =>
  act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })

function nameField(renderer: TestRenderer.ReactTestRenderer) {
  return renderer.root.findByProps({ placeholder: NAME_PLACEHOLDER })
}

function confirmSheet(renderer: TestRenderer.ReactTestRenderer) {
  return renderer.root.findByProps({ testID: 'add-close-confirm' })
}

/** Find the nearest pressable ancestor of a Text node with the given content. */
function pressableByText(
  renderer: TestRenderer.ReactTestRenderer,
  text: string,
): TestRenderer.ReactTestInstance {
  let node: TestRenderer.ReactTestInstance | null = renderer.root.findAll(
    (n) =>
      String(n.type) === 'Text' &&
      typeof n.props.children === 'string' &&
      n.props.children === text,
  )[0]
  while (node) {
    if (typeof node.props.onPress === 'function') return node
    node = node.parent
  }
  throw new Error(`No pressable ancestor found for ${text}`)
}

/** Tap the footer Cancel button (routes through the close handler). */
function tapCancel(renderer: TestRenderer.ReactTestRenderer) {
  act(() => {
    pressableByText(renderer, 'cancel').props.onPress()
  })
}

describe('AddModal draft autosave + close choice', () => {
  let realOS: typeof Platform.OS

  beforeEach(async () => {
    realOS = Platform.OS
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' })
    jest.clearAllMocks()
    await AsyncStorage.clear()
  })

  afterEach(() => {
    act(() => {
      mountedRenderers.forEach((r) => {
        try {
          r.unmount()
        } catch {
          // already unmounted by the test
        }
      })
    })
    mountedRenderers.length = 0
    Object.defineProperty(Platform, 'OS', { configurable: true, value: realOS })
  })

  it('opens a save-or-exit choice instead of discarding when closing with unsaved content', async () => {
    const onClose = jest.fn()
    const r = await openAddModal({ onClose })
    act(() => {
      nameField(r).props.onChangeText(NAME_PLACEHOLDER)
    })

    expect(confirmSheet(r).props.visible).toBe(false)

    tapCancel(r)

    // The choice sheet is shown and the screen has NOT closed yet.
    expect(confirmSheet(r).props.visible).toBe(true)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('keeps the entry as a draft when the user chooses Save draft, restoring it on the next open', async () => {
    const onClose = jest.fn()
    const r1 = await openAddModal({ onClose })
    act(() => {
      nameField(r1).props.onChangeText(NAME_PLACEHOLDER)
    })

    tapCancel(r1)
    act(() => {
      pressableByText(r1, 'add_save_draft').props.onPress()
    })
    expect(onClose).toHaveBeenCalledTimes(1)

    // The route tears down after onClose.
    await act(async () => {
      r1.unmount()
    })
    await flush()

    const r2 = await openAddModal()
    expect(nameField(r2).props.value).toBe(NAME_PLACEHOLDER)
  })

  it('drops the entry when the user chooses Discard — next open is blank', async () => {
    const onClose = jest.fn()
    const r1 = await openAddModal({ onClose })
    act(() => {
      nameField(r1).props.onChangeText(NAME_PLACEHOLDER)
    })

    tapCancel(r1)
    act(() => {
      pressableByText(r1, 'add_discard').props.onPress()
    })
    expect(onClose).toHaveBeenCalledTimes(1)

    await act(async () => {
      r1.unmount()
    })
    await flush()

    const r2 = await openAddModal()
    expect(nameField(r2).props.value).toBe('')
  })

  it('closes immediately without a choice when the form is empty', async () => {
    const onClose = jest.fn()
    const r = await openAddModal({ onClose })

    tapCancel(r)

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(confirmSheet(r).props.visible).toBe(false)
  })

  it('autosaves on an uncontrolled exit (back/swipe) so nothing is lost', async () => {
    const r1 = await openAddModal()
    act(() => {
      nameField(r1).props.onChangeText(NAME_PLACEHOLDER)
    })

    // No close button pressed — the component just unmounts (hardware back /
    // swipe-dismiss). The safety net must persist the in-progress entry.
    await act(async () => {
      r1.unmount()
    })
    await flush()

    const r2 = await openAddModal()
    expect(nameField(r2).props.value).toBe(NAME_PLACEHOLDER)
  })

  it('does not resurface a saved entry as a draft on the next open', async () => {
    mockCreateTaste.mockResolvedValue({ id: 'taste-1' })

    const onSaved = jest.fn()
    const r1 = await openAddModal({ onSaved })
    act(() => {
      r1.root.findByProps({ testID: 'add-mode-todo-btn' }).props.onPress()
    })
    act(() => {
      nameField(r1).props.onChangeText('Saved entry')
    })

    const saveButton = pressableByText(r1, 'save_taste_web')
    await act(async () => {
      await saveButton.props.onPress()
    })
    await flush()

    expect(onSaved).toHaveBeenCalledWith('taste-1')
    expect(await AsyncStorage.getItem('yon_add_draft:u1')).toBeNull()

    const r2 = await openAddModal()
    expect(nameField(r2).props.value).toBe('')
  })
})
