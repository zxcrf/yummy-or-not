/* ============================================================
   Regression tests — TagManageView (tag rename + delete).

   Pins:
   - rename calls renameTag and invalidateTagsCache on success
   - name_conflict error surfaces as inline text (not a crash/alert)
   - delete fires Alert.alert confirm path calling deleteTag
   - full-screen editor renders (no KeyboardStickyView)
   - dirty-cancel guard shows ConfirmSheet; non-dirty cancel closes directly
   ============================================================ */

import TestRenderer, { act } from 'react-test-renderer'
import { Alert } from 'react-native'
import TagManageView from '../TagManageView'

// Full-screen editor uses KeyboardAwareScrollView from react-native-keyboard-controller.
// Stub it (and any other exports the module surface needs) with a plain View so
// the component tree renders in jest-expo without native modules.
jest.mock('react-native-keyboard-controller', () => {
  const React = require('react')
  const { View } = require('react-native')
  return {
    KeyboardAwareScrollView: ({ children, ...props }: { children: React.ReactNode; [key: string]: unknown }) =>
      React.createElement(View, { testID: 'kb-aware-scroll', ...props }, children),
  }
})

// EditActionHeader and ConfirmSheet call useSafeAreaInsets(), which throws without
// a provider under jest-expo. Stub with zero insets — same pattern as AddModal tests.
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 34, left: 0, right: 0 }),
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
        discard_changes_body: 'Your changes will be lost.',
        discard_changes_title: 'Discard changes?',
        discard_confirm: 'Discard',
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

// Collected renderers for afterEach unmount (jest-async-leaks.md requirement).
const mountedRenderers: TestRenderer.ReactTestRenderer[] = []

async function renderTagManageView(): Promise<TestRenderer.ReactTestRenderer> {
  let renderer!: TestRenderer.ReactTestRenderer
  await act(async () => {
    renderer = TestRenderer.create(<TagManageView />)
  })
  mountedRenderers.push(renderer)
  return renderer
}

afterEach(() => {
  act(() => {
    mountedRenderers.forEach((r) => r.unmount())
  })
  mountedRenderers.length = 0
  jest.clearAllMocks()
})

describe('TagManageView — rename', () => {
  it('rename success calls renameTag then invalidateTagsCache', async () => {
    mockRenameTag.mockResolvedValueOnce({ id: 'tag-1', name: 'Very Spicy' })
    const renderer = await renderTagManageView()

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
  // screen. It must use the generic t('save').
  it('rename confirm button shows the generic save label, not the taste-record string', async () => {
    const renderer = await renderTagManageView()
    act(() => {
      renderer.root.findByProps({ testID: 'rename-tag-tag-1' }).props.onPress()
    })
    const confirmBtn = renderer.root.findByProps({ testID: 'rename-confirm-btn' })
    expect(confirmBtn.props.children).toBe('Save')
    expect(confirmBtn.props.children).not.toBe('Save this taste')
  })

  it('name_conflict error renders inline error text without crashing', async () => {
    mockRenameTag.mockRejectedValueOnce(new Error('name_conflict'))
    const renderer = await renderTagManageView()

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

describe('TagManageView — full-screen editor', () => {
  // Regression: the rename used a bottom-sheet. It is now a full-screen editor
  // with a pinned EditActionHeader and a KeyboardAwareScrollView. This test fails
  // if the input or save button disappear from the tree after openRename.
  it('renders rename-tag-input and rename-confirm-btn after openRename', async () => {
    const renderer = await renderTagManageView()

    act(() => {
      renderer.root.findByProps({ testID: 'rename-tag-tag-1' }).props.onPress()
    })

    expect(renderer.root.findByProps({ testID: 'rename-tag-input' })).toBeTruthy()
    expect(renderer.root.findByProps({ testID: 'rename-confirm-btn' })).toBeTruthy()

    // Keyboard contract (the field/cursor must stay above the keyboard): the
    // full-screen editor scrolls inside KeyboardAwareScrollView with a 16dp
    // keyboard margin and a safe-area-aware resting bottom pad. Regression guard
    // for accidental removal of these props (insets.bottom mocked to 34).
    const kb = renderer.root.findByProps({ testID: 'kb-aware-scroll' })
    expect(kb.props.bottomOffset).toBe(16)
    expect(kb.props.keyboardShouldPersistTaps).toBe('handled')
    expect(kb.props.keyboardDismissMode).toBe('interactive')
    expect(kb.props.contentContainerStyle.paddingBottom).toBe(50)
  })

  // The header (save button) must appear before the input in document order —
  // pinned-header-above-scroll is the full-screen layout contract.
  it('EditActionHeader save button appears before the input in document order', async () => {
    const renderer = await renderTagManageView()

    act(() => {
      renderer.root.findByProps({ testID: 'rename-tag-tag-1' }).props.onPress()
    })

    const order = renderer.root.findAll(
      (n) =>
        n.props?.testID === 'rename-confirm-btn' ||
        n.props?.testID === 'rename-tag-input'
    )
    expect(order[0].props.testID).toBe('rename-confirm-btn')
    expect(order[order.length - 1].props.testID).toBe('rename-tag-input')
  })
})

describe('TagManageView — dirty-cancel guard', () => {
  // Dirty edit: changing the value then tapping cancel must open ConfirmSheet.
  // Confirming the sheet must close the editor (input disappears).
  it('dirty edit + cancel shows confirm sheet; confirming closes editor', async () => {
    const renderer = await renderTagManageView()

    act(() => {
      renderer.root.findByProps({ testID: 'rename-tag-tag-1' }).props.onPress()
    })

    // Make it dirty
    act(() => {
      renderer.root.findByProps({ testID: 'rename-tag-input' }).props.onChangeText('Spicy Edited')
    })

    // Tap cancel — dirty, so should open ConfirmSheet, not close
    act(() => {
      renderer.root.findByProps({ testID: 'rename-cancel-btn' }).props.onPress()
    })

    // ConfirmSheet should now be visible (tag-cancel-confirm overlay)
    const confirmOverlay = renderer.root.findByProps({ testID: 'tag-cancel-confirm' })
    expect(confirmOverlay).toBeTruthy()

    // Tap the confirm button (discard)
    act(() => {
      renderer.root.findByProps({ testID: 'tag-cancel-confirm-confirm' }).props.onPress()
    })

    // Editor must be closed — rename-tag-input no longer in tree
    expect(
      renderer.root.findAll((n) => n.props?.testID === 'rename-tag-input')
    ).toHaveLength(0)
  })

  // Non-dirty cancel: open then cancel without changing the value → closes directly,
  // no ConfirmSheet.
  it('non-dirty cancel closes editor without showing confirm sheet', async () => {
    const renderer = await renderTagManageView()

    act(() => {
      renderer.root.findByProps({ testID: 'rename-tag-tag-1' }).props.onPress()
    })

    // Do NOT change the value — tap cancel immediately
    act(() => {
      renderer.root.findByProps({ testID: 'rename-cancel-btn' }).props.onPress()
    })

    // ConfirmSheet must NOT appear
    expect(
      renderer.root.findAll((n) => n.props?.testID === 'tag-cancel-confirm')
    ).toHaveLength(0)

    // Editor must be closed
    expect(
      renderer.root.findAll((n) => n.props?.testID === 'rename-tag-input')
    ).toHaveLength(0)
  })
})

describe('TagManageView — delete', () => {
  it('pressing delete button shows Alert.alert with the confirm title', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {})
    const renderer = await renderTagManageView()

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

    const renderer = await renderTagManageView()
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
