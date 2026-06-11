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
        save_taste: 'Save',
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
