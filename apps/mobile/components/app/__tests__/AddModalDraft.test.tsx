/* ============================================================
   Regression test — AddModal draft autosave.

   User feedback (2026-06): "早上用 yummy 不小心按到取消的时候没有自动保存草稿，
   直接没有了" — a mis-tapped Cancel on the Add screen threw away everything
   typed, with no autosaved draft.

   These tests pin the fix:
   1. Closing the Add screen without saving (the route tears down on
      Cancel / ✕ / back) persists the in-progress entry, and the next open
      restores it. Against the pre-fix code this fails — the second open
      starts blank.
   2. A successful save clears the draft, so a saved entry does NOT resurface
      as a draft on the next open.

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

jest.mock('@/providers/I18nProvider', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

const NAME_PLACEHOLDER = 'Brown sugar boba'

const mountedRenderers: TestRenderer.ReactTestRenderer[] = []

/** Mount AddModal and let the initial draft-load (hydration) settle. */
async function openAddModal(
  onSaved: (id: string) => void = () => {},
): Promise<TestRenderer.ReactTestRenderer> {
  let renderer!: TestRenderer.ReactTestRenderer
  await act(async () => {
    renderer = TestRenderer.create(
      <AddModal onClose={() => {}} onSaved={onSaved} />,
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

describe('AddModal draft autosave', () => {
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

  it('restores the in-progress entry after the screen is closed without saving', async () => {
    // First open: type a name, then close WITHOUT saving (Cancel / ✕ / back all
    // tear the route — and the component — down).
    const r1 = await openAddModal()
    act(() => {
      nameField(r1).props.onChangeText(NAME_PLACEHOLDER)
    })

    await act(async () => {
      r1.unmount()
    })
    // Let the unmount flush's saveDraft write complete.
    await flush()

    // Second open: the draft must be restored, not blank.
    const r2 = await openAddModal()
    expect(nameField(r2).props.value).toBe(NAME_PLACEHOLDER)
  })

  it('does not resurface a saved entry as a draft on the next open', async () => {
    mockCreateTaste.mockResolvedValue({ id: 'taste-1' })

    // Open, fill, and save (todo mode needs no verdict — keeps the test focused
    // on draft lifecycle).
    const onSaved = jest.fn()
    const r1 = await openAddModal(onSaved)
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
    // The draft for this account must have been cleared.
    expect(await AsyncStorage.getItem('yon_add_draft:u1')).toBeNull()

    // A fresh open starts blank — the saved entry does not linger as a draft.
    const r2 = await openAddModal()
    expect(nameField(r2).props.value).toBe('')
  })
})
