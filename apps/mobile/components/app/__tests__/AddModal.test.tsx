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
import { KeyboardAvoidingView, Platform, ScrollView } from 'react-native'
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

let mockUserTags: Array<{ id: string; name: string; createdAt: string }> = []
const mockInvalidateTagsCache = jest.fn()
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
  const realOS = Platform.OS

  beforeEach(() => {
    jest.clearAllMocks()
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' })
  })

  afterAll(() => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: realOS })
  })

  it('shows only the large photo dropzone label on native', () => {
    const renderer = renderAddModal()

    expect(textNodes(renderer, 'Add a photo')).toHaveLength(1)
  })

  it('insets the sticky header below the status bar so the title is not overlapped', () => {
    const renderer = renderAddModal()

    // The sticky header is the only node carrying a 3px bottom border.
    const headers = renderer.root.findAllByProps({ borderBottomWidth: 3 })
    expect(headers.length).toBeGreaterThan(0)
    // Regression: header top padding must clear the safe-area top inset
    // (status bar). The old code used a fixed paddingVertical and overlapped.
    expect(headers.some((n) => n.props.paddingTop === mockSafeAreaTop + 16)).toBe(true)
  })

  it('shows a real permission error instead of another Add a photo label', async () => {
    mockRequestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: false })
    const renderer = renderAddModal()
    const dropzone = renderer.root.findByProps({ 'aria-label': 'Add a photo' })

    await act(async () => {
      await dropzone.props.onPress()
    })

    expect(textNodes(renderer, 'Add a photo')).toHaveLength(1)
    expect(textNodes(renderer, 'Photo access is needed to choose a picture.')).toHaveLength(1)
    expect(mockLaunchImageLibraryAsync).not.toHaveBeenCalled()
  })

  it('insets the keyboard with padding (never "height", never none) so bottom inputs stay reachable', () => {
    // Two regressions guarded at once:
    //  - behavior="height" animated the container height and collapsed this
    //    flex body to a sliver during the open transition (the flicker).
    //  - NO behavior left the keyboard floating over the content under Expo
    //    SDK 54+ edge-to-edge, hiding the custom-tag / notes / save row.
    // "padding" only grows the bottom inset: no collapse, and the scroll
    // viewport ends above the keyboard so the bottom fields are reachable.
    const renderer = renderAddModal()
    const kav = renderer.root.findByType(KeyboardAvoidingView)
    expect(kav.props.behavior).toBe('padding')
    expect(kav.props.behavior).not.toBe('height')
  })

  it('keeps behavior="padding" on iOS too', () => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' })
    const renderer = renderAddModal()
    const kav = renderer.root.findByType(KeyboardAvoidingView)
    expect(kav.props.behavior).toBe('padding')
  })

  it('scrolls the form to the end when a bottom field (notes) is focused so it clears the keyboard', () => {
    // Padding alone shrinks the viewport but does not move the focused field
    // into it. Focusing a below-the-fold field must scroll the form up so it
    // sits above the keyboard — like every other app.
    jest.useFakeTimers()
    const scrollToEnd = jest
      .spyOn(ScrollView.prototype, 'scrollToEnd')
      .mockImplementation(() => {})
    try {
      const renderer = renderAddModal()
      const notes = renderer.root.findByProps({
        placeholder: 'Too sweet, but the texture was perfect…',
      })
      act(() => {
        notes.props.onFocus?.({})
      })
      act(() => {
        jest.advanceTimersByTime(200)
      })

      expect(scrollToEnd).toHaveBeenCalled()
    } finally {
      scrollToEnd.mockRestore()
      jest.useRealTimers()
    }
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
