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
import { KeyboardAvoidingView, Platform } from 'react-native'
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

jest.mock('@yon/shared', () => ({
  TAG_CHOICES: ['Boba', 'Coffee'],
  createTaste: (...args: unknown[]) => mockCreateTaste(...args),
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

  it('does not use KeyboardAvoidingView behavior="height" on Android', () => {
    // Regression: the modal flickered on open — the body repeatedly collapsed
    // to a sliver (clipped title, zero-height ScrollView, only the header
    // border + close button left). Cause: under Expo SDK 54+ edge-to-edge the
    // Android window already resizes for the keyboard; `behavior="height"`
    // double-resized and squeezed this flex body during the open animation.
    // Android must therefore use NO behavior (the window handles avoidance).
    const renderer = renderAddModal()
    const kav = renderer.root.findByType(KeyboardAvoidingView)
    expect(kav.props.behavior).toBeUndefined()
  })

  it('keeps KeyboardAvoidingView behavior="padding" on iOS', () => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' })
    const renderer = renderAddModal()
    const kav = renderer.root.findByType(KeyboardAvoidingView)
    expect(kav.props.behavior).toBe('padding')
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
})
