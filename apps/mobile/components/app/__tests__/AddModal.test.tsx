/* ============================================================
   Regression tests — AddModal photo affordances and custom tags.

   User feedback:
   - The add screen showed three "Add a photo" affordances: the large
     dropzone, a small native button, and a red error message using the
     same label when permission failed.
   - Tags could only be picked from the canned list.

   These tests pin the intended behavior: one visible photo entry point,
   a real permission error message, and custom tags included in the
   createTaste payload.
   ============================================================ */

import TestRenderer, { act } from 'react-test-renderer'
import { Platform } from 'react-native'
import AddModal from '../AddModal'

const mockCreateTaste = jest.fn()
const mockLaunchImageLibraryAsync = jest.fn()
const mockRequestMediaLibraryPermissionsAsync = jest.fn()

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

  it('saves a newly added custom tag with the taste payload', async () => {
    mockCreateTaste.mockResolvedValue({ id: 'taste-1' })
    const onSaved = jest.fn()
    let renderer!: TestRenderer.ReactTestRenderer
    act(() => {
      renderer = TestRenderer.create(<AddModal onClose={() => {}} onSaved={onSaved} />)
    })

    const nameField = renderer.root.findByProps({ placeholder: 'Brown sugar boba' })
    const tagField = renderer.root.findByProps({ placeholder: 'New tag' })
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
