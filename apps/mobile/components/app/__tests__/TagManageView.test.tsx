/* ============================================================
   Regression tests — TagManageView (tag rename + delete).

   Pins:
   - rename calls renameTag and invalidateTagsCache on success
   - name_conflict error surfaces as inline text (not a crash/alert)
   - delete fires Alert.alert confirm path calling deleteTag
   ============================================================ */

import TestRenderer, { act } from 'react-test-renderer'
import { Alert } from 'react-native'
import TagManageView from '../TagManageView'

// The shared jest.setup.js mock aliases KeyboardStickyView to a plain RN View,
// so it can't be told apart from any other View by type. Override it here with
// an identifiable wrapper (carrying a dedicated testID) so the keyboard test can
// assert the rename sheet content actually lives INSIDE the sticky view — and
// fails if the wrapper is ever removed.
const KEYBOARD_STICKY_TESTID = 'rename-keyboard-sticky'
jest.mock('react-native-keyboard-controller', () => {
  const React = require('react')
  const { View } = require('react-native')
  return {
    KeyboardStickyView: ({ children }: { children: React.ReactNode }) =>
      React.createElement(View, { testID: 'rename-keyboard-sticky' }, children),
  }
})

// EditActionHeader (now hosting the rename save/cancel) calls
// useSafeAreaInsets(), which throws without a provider under jest-expo. Stub it
// with zero insets — same pattern as the AddModalFooter / EditActionHeader tests.
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}))

const mockRenameTag = jest.fn()
const mockDeleteTag = jest.fn()
const mockInvalidateTagsCache = jest.fn()

const TAGS = [
  { id: 'tag-1', name: 'Spicy' },
  { id: 'tag-2', name: 'Sweet' },
]

jest.mock('@yon/shared', () => ({
  renameTag: (...args: unknown[]) => mockRenameTag(...args),
  deleteTag: (...args: unknown[]) => mockDeleteTag(...args),
}))

jest.mock('@/app/(tabs)/_useTags', () => ({
  useTags: () => ({ tags: TAGS, loading: false }),
  invalidateTagsCache: (...args: unknown[]) => mockInvalidateTagsCache(...args),
}))

jest.mock('@/providers/I18nProvider', () => ({
  useI18n: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        cancel: 'Cancel',
        del: 'Delete',
        save: 'Save',
        save_taste: 'Save this taste',
        tag_delete_confirm: 'Delete tag?',
        tag_empty: 'No tags yet',
        tag_manage: 'Tag library',
        tag_name_conflict: 'A tag with that name already exists',
        tag_rename: 'Rename',
      }
      return map[key] ?? key
    },
  }),
}))

function renderTagManageView(): TestRenderer.ReactTestRenderer {
  let renderer!: TestRenderer.ReactTestRenderer
  act(() => {
    renderer = TestRenderer.create(<TagManageView />)
  })
  return renderer
}

describe('TagManageView — rename', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('rename success calls renameTag then invalidateTagsCache', async () => {
    mockRenameTag.mockResolvedValueOnce({ id: 'tag-1', name: 'Very Spicy' })
    const renderer = renderTagManageView()

    // Open rename modal for first tag
    act(() => {
      renderer.root.findByProps({ testID: 'rename-tag-tag-1' }).props.onPress()
    })

    // Update input
    act(() => {
      renderer.root.findByProps({ testID: 'rename-tag-input' }).props.onChangeText('Very Spicy')
    })

    await act(async () => {
      await renderer.root.findByProps({ testID: 'rename-confirm-btn' }).props.onPress()
    })

    expect(mockRenameTag).toHaveBeenCalledWith('tag-1', { name: 'Very Spicy' })
    expect(mockInvalidateTagsCache).toHaveBeenCalled()
  })

  // Regression (#103): the rename save button reused t('save_taste') =
  // "保存这个口味" / "Save this taste", which makes no sense on a tag-rename
  // sheet. It must use the generic t('save').
  it('rename confirm button shows the generic save label, not the taste-record string', () => {
    const renderer = renderTagManageView()
    act(() => {
      renderer.root.findByProps({ testID: 'rename-tag-tag-1' }).props.onPress()
    })
    const confirmBtn = renderer.root.findByProps({ testID: 'rename-confirm-btn' })
    expect(confirmBtn.props.children).toBe('Save')
    expect(confirmBtn.props.children).not.toBe('Save this taste')
  })

  it('name_conflict error renders inline error text without crashing', async () => {
    mockRenameTag.mockRejectedValueOnce(new Error('name_conflict'))
    const renderer = renderTagManageView()

    act(() => {
      renderer.root.findByProps({ testID: 'rename-tag-tag-1' }).props.onPress()
    })
    act(() => {
      renderer.root.findByProps({ testID: 'rename-tag-input' }).props.onChangeText('Sweet')
    })

    await act(async () => {
      await renderer.root.findByProps({ testID: 'rename-confirm-btn' }).props.onPress()
    })

    const errorEl = renderer.root.findByProps({ testID: 'rename-error' })
    expect(errorEl).toBeTruthy()
    expect(errorEl.props.children).toBe('A tag with that name already exists')
    // invalidateTagsCache must NOT be called on conflict
    expect(mockInvalidateTagsCache).not.toHaveBeenCalled()
  })
})

describe('TagManageView — rename sheet keyboard handling', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  // Regression: the rename bottom-sheet had no keyboard handling, so when the
  // soft keyboard opened it covered the rename input and the save/cancel
  // buttons (the "标签管理" page bug). The fix wraps the sheet content in
  // react-native-keyboard-controller's KeyboardStickyView so it rides up with
  // the keyboard — the same strategy AddModal's footer / AuthScreen use. This
  // test fails if the sheet content is no longer inside a KeyboardStickyView.
  it('renders the rename input and save button inside a KeyboardStickyView', () => {
    const renderer = renderTagManageView()

    act(() => {
      renderer.root.findByProps({ testID: 'rename-tag-tag-1' }).props.onPress()
    })

    // findByProps throws if the sticky wrapper is absent — i.e. if the sheet
    // content is rendered bare (the original bug). The input and confirm button
    // must be descendants so they float above the keyboard, not behind it.
    const sticky = renderer.root.findByProps({ testID: KEYBOARD_STICKY_TESTID })
    expect(sticky.findByProps({ testID: 'rename-tag-input' })).toBeTruthy()
    expect(sticky.findByProps({ testID: 'rename-confirm-btn' })).toBeTruthy()
  })

  // The save/cancel controls moved into the shared EditActionHeader at the TOP
  // of the sheet (取消 left · title center · save right). The header must still
  // live inside the KeyboardStickyView so the whole sheet floats above the
  // keyboard, and the rename input must render BELOW it (later in the subtree).
  it('renders the EditActionHeader (cancel + save) above the input, inside the sticky', () => {
    const renderer = renderTagManageView()

    act(() => {
      renderer.root.findByProps({ testID: 'rename-tag-tag-1' }).props.onPress()
    })

    const sticky = renderer.root.findByProps({ testID: KEYBOARD_STICKY_TESTID })
    // Header confirm button + the input are both sticky descendants.
    const confirm = sticky.findByProps({ testID: 'rename-confirm-btn' })
    const input = sticky.findByProps({ testID: 'rename-tag-input' })
    expect(confirm).toBeTruthy()
    expect(input).toBeTruthy()

    // Top placement: the save control appears before the input in document order.
    const order = sticky.findAll(
      (n) =>
        n.props?.testID === 'rename-confirm-btn' ||
        n.props?.testID === 'rename-tag-input'
    )
    expect(order[0].props.testID).toBe('rename-confirm-btn')
    expect(order[order.length - 1].props.testID).toBe('rename-tag-input')
  })
})

describe('TagManageView — delete', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('pressing delete button shows Alert.alert with the confirm title', () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {})
    const renderer = renderTagManageView()

    act(() => {
      renderer.root.findByProps({ testID: 'delete-tag-tag-2' }).props.onPress()
    })

    expect(alertSpy).toHaveBeenCalledWith(
      'Delete tag?',
      undefined,
      expect.arrayContaining([
        expect.objectContaining({ style: 'destructive' }),
      ])
    )
    alertSpy.mockRestore()
  })

  it('confirm path calls deleteTag and invalidateTagsCache', async () => {
    mockDeleteTag.mockResolvedValueOnce(undefined)
    let destructiveOnPress: (() => Promise<void>) | undefined
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _msg, buttons) => {
      const btn = (buttons ?? []).find((b) => b.style === 'destructive')
      destructiveOnPress = btn?.onPress as (() => Promise<void>) | undefined
    })

    const renderer = renderTagManageView()
    act(() => {
      renderer.root.findByProps({ testID: 'delete-tag-tag-2' }).props.onPress()
    })

    await act(async () => {
      await destructiveOnPress?.()
    })

    expect(mockDeleteTag).toHaveBeenCalledWith('tag-2')
    expect(mockInvalidateTagsCache).toHaveBeenCalled()
    jest.restoreAllMocks()
  })
})
