/* ============================================================
   Regression tests — AddModal photo affordances and custom tags.

   User feedback:
   - The add screen showed three "Add a photo" affordances: the large
     dropzone, a small native button, and a red error message using the
     same label when permission failed.
   - Tags could only be picked from the canned list.

   - On Android the sticky header title sat under the status bar.

   These tests pin the intended behavior: one visible photo entry point,
   a real permission error message, custom tags included in the createTaste
   payload, and a header inset below the safe-area (status bar).
   ============================================================ */

import TestRenderer, { act } from 'react-test-renderer'
import { Platform } from 'react-native'
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller'
import AddModal from '../AddModal'

const mockCreateTaste = jest.fn()
const mockLaunchImageLibraryAsync = jest.fn()
const mockRequestMediaLibraryPermissionsAsync = jest.fn()

// Non-zero top inset so the status-bar regression below is meaningful.
const mockSafeAreaTop = 47

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: mockSafeAreaTop, bottom: 0, left: 0, right: 0 }),
}))

jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: (...args: unknown[]) =>
    mockRequestMediaLibraryPermissionsAsync(...args),
  launchImageLibraryAsync: (...args: unknown[]) => mockLaunchImageLibraryAsync(...args),
}))

jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: jest.fn(),
  SaveFormat: { JPEG: 'jpeg' },
}))

const mockCreateTag = jest.fn()

jest.mock('@yon/shared', () => ({
  TAG_CHOICES: ['Boba', 'Coffee'],
  createTaste: (...args: unknown[]) => mockCreateTaste(...args),
  createTag: (...args: unknown[]) => mockCreateTag(...args),
  searchTastes: jest.fn().mockReturnValue([]),
}))

// AddModal invalidates the shared taste cache after a successful save; that
// hook has its own suite, so stub it to a no-op here.
jest.mock('@/app/(tabs)/_useTastes', () => ({
  invalidateTastes: jest.fn(async () => []),
  useRefreshableTastes: () => ({ items: [], refresh: jest.fn() }),
}))

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
}))

jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({ user: { warningsEnabled: true } }),
}))

// Self taster (null) — no persona switching in these tests. Mocked so the real
// hook's async listener never fires a setState after the suite ends (act-leak).
jest.mock('@/app/(tabs)/_useActiveTaster', () => ({
  useActiveTaster: () => null,
}))

let mockUserTags: Array<{ id: string; name: string; createdAt: string }> = []
const mockInvalidateTagsCache = jest.fn()
jest.mock('@/app/(tabs)/_useTasters', () => ({
  useTasters: () => ({ tasters: [], loading: false }),
}))

jest.mock('@/app/(tabs)/_useTags', () => ({
  useTags: () => ({ tags: mockUserTags, loading: false }),
  invalidateTagsCache: (...args: unknown[]) => mockInvalidateTagsCache(...args),
  clearTagsCache: jest.fn(),
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
      photo_permission_denied: 'Photo access is needed to choose a picture.',
      save_taste_web: 'Save taste',
      tag_placeholder: 'New tag',
      tags: 'Tags',
      v_meh: 'MEH',
      v_nah: 'NAH',
      v_yum: 'YUM',
      your_take: 'Your take',
    }[key] ?? key),
  }),
}))

function renderAddModal(): TestRenderer.ReactTestRenderer {
  let renderer!: TestRenderer.ReactTestRenderer
  act(() => {
    renderer = TestRenderer.create(
      <AddModal onClose={() => {}} onSaved={() => {}} />,
    )
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

function pressableByText(
  renderer: TestRenderer.ReactTestRenderer,
  text: string,
): TestRenderer.ReactTestInstance {
  let node: TestRenderer.ReactTestInstance | null = textNodes(renderer, text)[0]
  while (node) {
    if (typeof node.props.onPress === 'function') return node
    node = node.parent
  }
  throw new Error(`No pressable ancestor found for ${text}`)
}

describe('AddModal', () => {
  let realOS: typeof Platform.OS

  beforeEach(() => {
    realOS = Platform.OS
    jest.useFakeTimers()
    jest.clearAllMocks()
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' })
  })

  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: realOS })
    jest.clearAllTimers()
    jest.useRealTimers()
  })

  it('shows only the large photo dropzone label on native', () => {
    const renderer = renderAddModal()

    expect(textNodes(renderer, 'Add a photo')).toHaveLength(1)
  })

  it('insets the unified header below the status bar so the title is not overlapped', () => {
    const renderer = renderAddModal()

    // The header is now the shared EditActionHeader (variant="screen"). Both the
    // composite element and its rendered host View carry the testID; pick the
    // host View — the one that actually carries the layout style object.
    const header = renderer.root.findAll(
      (n) => n.props.testID === 'add-modal-header' && n.props.style != null,
    )[0]
    expect(header).toBeTruthy()
    // Regression: header top padding must clear the safe-area top inset
    // (status bar). variant="screen" uses insets.top + 12 and a 3px bottom border.
    const st = header.props.style as Record<string, unknown>
    expect(st.borderBottomWidth).toBe(3)
    expect(st.paddingTop).toBe(mockSafeAreaTop + 12)
  })

  it('shows a real permission error instead of another Add a photo label', async () => {
    mockRequestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: false })
    const renderer = renderAddModal()
    const dropzone = renderer.root.findByProps({ accessibilityLabel: 'Add a photo' })

    await act(async () => {
      await dropzone.props.onPress()
    })

    expect(textNodes(renderer, 'Add a photo')).toHaveLength(1)
    expect(textNodes(renderer, 'Photo access is needed to choose a picture.')).toHaveLength(1)
    expect(mockLaunchImageLibraryAsync).not.toHaveBeenCalled()
  })

  it('uses a small constant bottomOffset (footer moved to the top header)', () => {
    // The save/cancel actions now live in the top EditActionHeader, not a
    // sticky footer riding the keyboard. The header never overlaps the keyboard,
    // so bottomOffset no longer needs to reserve footer height — it is just the
    // 16dp keyboard margin. Regression guard: it must NOT grow with a (now
    // deleted) footer height.
    const renderer = renderAddModal()
    const scroll = renderer.root.findByType(KeyboardAwareScrollView)
    expect(scroll.props.bottomOffset).toBe(16)
  })

  it('uses a small constant scroll content paddingBottom (insets.bottom + 16)', () => {
    // With the sticky footer gone, the resting bottom inset is just the
    // safe-area bottom + a 16dp margin; there is no footer height to reserve.
    // mockSafeAreaTop's companion bottom inset is 0 here, so paddingBottom = 16.
    const renderer = renderAddModal()
    const scroll = renderer.root.findByType(KeyboardAwareScrollView)
    const style = scroll.props.contentContainerStyle
    expect(style.paddingBottom).toBe(16)
  })

  it('keeps the same KeyboardAwareScrollView construction on iOS (no Platform keyboard branch)', () => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' })
    const renderer = renderAddModal()
    // Single construction both platforms — no Platform.OS keyboard branching.
    expect(renderer.root.findAllByType(KeyboardAwareScrollView)).toHaveLength(1)
  })

  it('no longer renders the old sticky action footer', () => {
    // Save/cancel moved to the top EditActionHeader; the bottom action footer
    // (testID="add-actions-footer") is deleted.
    const renderer = renderAddModal()
    expect(
      renderer.root.findAllByProps({ testID: 'add-actions-footer' }),
    ).toHaveLength(0)
  })

  it('saves via the header primary button (add-save-btn) when ready', async () => {
    mockCreateTaste.mockResolvedValue({ id: 'taste-hdr' })
    const onSaved = jest.fn()
    let renderer!: TestRenderer.ReactTestRenderer
    act(() => {
      renderer = TestRenderer.create(<AddModal onClose={() => {}} onSaved={onSaved} />)
    })

    const nameField = renderer.root.findByProps({ placeholder: 'Brown sugar boba' })
    const yumOption = pressableByText(renderer, 'YUM')
    act(() => {
      nameField.props.onChangeText('Brown sugar boba')
      yumOption.props.onPress()
    })

    const saveButton = renderer.root.findByProps({ testID: 'add-save-btn' })
    await act(async () => {
      await saveButton.props.onPress()
    })

    expect(mockCreateTaste).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Brown sugar boba', verdict: 'yum' }),
      null,
    )
    expect(onSaved).toHaveBeenCalledWith('taste-hdr')
  })

  it('cancel in the header routes through the close handler', () => {
    // An empty form closes immediately (no draft to keep), so onClose fires.
    const onClose = jest.fn()
    let renderer!: TestRenderer.ReactTestRenderer
    act(() => {
      renderer = TestRenderer.create(<AddModal onClose={onClose} onSaved={() => {}} />)
    })

    const cancel = pressableByText(renderer, 'Cancel')
    act(() => {
      cancel.props.onPress()
    })

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('saves a newly added custom tag with the taste payload', async () => {
    mockCreateTaste.mockResolvedValue({ id: 'taste-1' })
    const onSaved = jest.fn()
    let renderer!: TestRenderer.ReactTestRenderer
    act(() => {
      renderer = TestRenderer.create(<AddModal onClose={() => {}} onSaved={onSaved} />)
    })

    const nameField = renderer.root.findByProps({ placeholder: 'Brown sugar boba' })
    const tagField = renderer.root.findByProps({ placeholder: 'Add tag' })
    const addTagButton = pressableByText(renderer, 'Add tag')
    const yumOption = pressableByText(renderer, 'YUM')
    const saveButton = pressableByText(renderer, 'Save taste')

    act(() => {
      nameField.props.onChangeText('Brown sugar boba')
      tagField.props.onChangeText('Late night')
    })
    act(() => {
      addTagButton.props.onPress()
      yumOption.props.onPress()
    })
    await act(async () => {
      await saveButton.props.onPress()
    })

    expect(mockCreateTaste).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Brown sugar boba',
        verdict: 'yum',
        tags: ['Late night'],
      }),
      null,
    )
    expect(onSaved).toHaveBeenCalledWith('taste-1')
  })

  it('calls createTag for each custom tag after a successful save', async () => {
    mockCreateTaste.mockResolvedValue({ id: 'taste-2' })
    mockCreateTag.mockResolvedValue({ id: 'tag-1', name: 'Late night', createdAt: '' })
    mockUserTags = []

    let renderer!: TestRenderer.ReactTestRenderer
    act(() => {
      renderer = TestRenderer.create(<AddModal onClose={() => {}} onSaved={() => {}} />)
    })

    const nameField = renderer.root.findByProps({ placeholder: 'Brown sugar boba' })
    const tagField = renderer.root.findByProps({ placeholder: 'Add tag' })
    const addTagButton = pressableByText(renderer, 'Add tag')
    const yumOption = pressableByText(renderer, 'YUM')
    const saveButton = pressableByText(renderer, 'Save taste')

    act(() => {
      nameField.props.onChangeText('Mochi')
      tagField.props.onChangeText('Late night')
    })
    act(() => {
      addTagButton.props.onPress()
      yumOption.props.onPress()
    })
    await act(async () => {
      await saveButton.props.onPress()
    })

    // createTag must be called for the custom tag 'Late night' (not in TAG_CHOICES).
    await act(async () => {
      // Flush the fire-and-forget Promise.all chain.
      await Promise.resolve()
    })
    expect(mockCreateTag).toHaveBeenCalledWith({ name: 'Late night' })
    expect(mockCreateTag).toHaveBeenCalledTimes(1)
  })

  it('does NOT call createTag for built-in TAG_CHOICES tags', async () => {
    mockCreateTaste.mockResolvedValue({ id: 'taste-3' })
    mockCreateTag.mockResolvedValue({ id: 'tag-2', name: 'Boba', createdAt: '' })
    mockUserTags = []

    let renderer!: TestRenderer.ReactTestRenderer
    act(() => {
      renderer = TestRenderer.create(<AddModal onClose={() => {}} onSaved={() => {}} />)
    })

    const nameField = renderer.root.findByProps({ placeholder: 'Brown sugar boba' })
    const bobaChip = pressableByText(renderer, 'Boba')
    const yumOption = pressableByText(renderer, 'YUM')
    const saveButton = pressableByText(renderer, 'Save taste')

    act(() => {
      nameField.props.onChangeText('Boba tea')
      bobaChip.props.onPress()
      yumOption.props.onPress()
    })
    await act(async () => {
      await saveButton.props.onPress()
    })
    await act(async () => { await Promise.resolve() })

    expect(mockCreateTag).not.toHaveBeenCalled()
  })

  it('renders a chip for a tag from the user tag library (not in TAG_CHOICES)', () => {
    mockUserTags = [{ id: '99', name: 'Midnight Snack', createdAt: '' }]
    const renderer = renderAddModal()

    // The user tag library chip must appear alongside built-in chips.
    expect(textNodes(renderer, 'Midnight Snack')).toHaveLength(1)
    // Built-in chips still appear.
    expect(textNodes(renderer, 'Boba')).toHaveLength(1)
  })
})

describe('AddModal photo picker teardown', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.clearAllMocks()
  })

  afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
  })

  it('does not set photo/preview when picker is cancelled', async () => {
    mockRequestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: true })
    mockLaunchImageLibraryAsync.mockResolvedValue({ canceled: true, assets: [] })

    const renderer = renderAddModal()
    const dropzone = renderer.root.findByProps({ accessibilityLabel: 'Add a photo' })

    await act(async () => {
      await dropzone.props.onPress()
    })

    // After a cancelled pick, the dropzone still shows the camera icon placeholder
    // (no PhotoPreview rendered), so the "Add a photo" label remains the only one.
    expect(textNodes(renderer, 'Add a photo')).toHaveLength(1)
    // launchImageLibraryAsync was called but returned cancelled
    expect(mockLaunchImageLibraryAsync).toHaveBeenCalledTimes(1)
  })

  it('shows the permission error message when library permission is denied', async () => {
    mockRequestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: false })

    const renderer = renderAddModal()
    const dropzone = renderer.root.findByProps({ accessibilityLabel: 'Add a photo' })

    await act(async () => {
      await dropzone.props.onPress()
    })

    // launchImageLibraryAsync must NOT be called when permission was denied.
    expect(mockLaunchImageLibraryAsync).not.toHaveBeenCalled()
    // The permission error message must be visible.
    expect(
      textNodes(renderer, 'Photo access is needed to choose a picture.'),
    ).toHaveLength(1)
  })

  it('falls back gracefully when manipulateAsync throws during compress', async () => {
    const { manipulateAsync } = require('expo-image-manipulator')
    ;(manipulateAsync as jest.Mock).mockRejectedValueOnce(new Error('oom'))

    mockRequestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: true })
    mockLaunchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file://photo.jpg', width: 1000, mimeType: 'image/jpeg', fileName: 'photo.jpg' }],
    })

    const renderer = renderAddModal()
    const dropzone = renderer.root.findByProps({ accessibilityLabel: 'Add a photo' })

    // Should not throw even when manipulateAsync fails
    await act(async () => {
      await dropzone.props.onPress()
    })

    // The component must still be alive (no unmount crash).
    expect(renderer.root).toBeTruthy()
  })

  it('does not fire duplicate picks if the dropzone is pressed rapidly', async () => {
    mockRequestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: true })
    // Resolve immediately so the async chain completes without hanging.
    mockLaunchImageLibraryAsync.mockResolvedValue({ canceled: true, assets: [] })

    const renderer = renderAddModal()
    const dropzone = renderer.root.findByProps({ accessibilityLabel: 'Add a photo' })

    // Fire two rapid presses before the first async chain can complete.
    // The in-flight guard must absorb the second press so launchImageLibraryAsync
    // is only called once.
    await act(async () => {
      dropzone.props.onPress()
      dropzone.props.onPress()
      await Promise.resolve()
    })

    // Exactly 1 call: the guard blocked the second press.
    expect(mockLaunchImageLibraryAsync).toHaveBeenCalledTimes(1)
    // Component remains alive — no crash from duplicate async chains.
    expect(renderer.root).toBeTruthy()
  })
})
