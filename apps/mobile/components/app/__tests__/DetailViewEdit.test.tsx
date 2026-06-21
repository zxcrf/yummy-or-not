/* ============================================================
   Regression tests — editing a taste from its detail screen.

   Bug: tapping Edit on a taste detail did nothing because the button had no
   handler. The detail flow must expose editable fields and persist changes via
   PATCH so users can fix an existing taste without recreating it.
   ============================================================ */

import React from 'react'
import { StyleSheet } from 'react-native'
import TestRenderer, { act } from 'react-test-renderer'
import { getTaste, updateTaste, type Taste } from '@yon/shared'

import DetailView from '../DetailView'

// Mock safe-area insets with a nonzero top so the inset-doubling regression is
// detectable (top=0 would make doubling invisible).
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 47, bottom: 0, left: 0, right: 0 }),
}))

jest.mock('@yon/shared', () => ({
  TAG_CHOICES: ['Coffee', 'Dessert'],
  deleteTaste: jest.fn(),
  getTaste: jest.fn(),
  updateTaste: jest.fn(),
}))

// DetailView invalidates the shared taste cache after save/delete; that hook
// has its own suite, so stub it to a no-op here.
jest.mock('@/app/(tabs)/_useTastes', () => ({
  invalidateTastes: jest.fn(async () => []),
  // Edit flow exercises the cache-MISS path (item loads via getTaste mock).
  getCachedTaste: jest.fn(() => undefined),
}))

jest.mock('@/app/(tabs)/_useTags', () => ({
  useTags: () => ({ tags: [], loading: false }),
  invalidateTagsCache: jest.fn(),
}))

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'taste-1' }),
  useRouter: () => ({
    back: jest.fn(),
    canGoBack: jest.fn(() => true),
    replace: jest.fn(),
  }),
}))

jest.mock('@/providers/I18nProvider', () => ({
  useI18n: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      if (!values) return key
      if (values.n != null) return `${key}:${values.n}`
      return key
    },
    formatMoney: (amount: number | string) => {
      const n = typeof amount === 'number'
        ? amount
        : Number.parseFloat(String(amount).replace(/[^0-9.]/g, ''))
      if (!Number.isFinite(n)) return ''
      return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`
    },
  }),
}))

jest.mock('@/components/ds', () => {
  const React = require('react')

  return {
    Badge: ({ children, ...props }: { children?: React.ReactNode }) =>
      React.createElement('Badge', props, children),
    Button: ({ children, ...props }: { children?: React.ReactNode }) =>
      React.createElement('Button', props, children),
    Card: ({ children, ...props }: { children?: React.ReactNode }) =>
      React.createElement('Card', props, children),
    ConfirmSheet: (props: Record<string, unknown>) =>
      React.createElement('ConfirmSheet', props),
    EditActionHeader: (props: Record<string, unknown>) =>
      React.createElement('EditActionHeader', props),
    Icon: (props: Record<string, unknown>) => React.createElement('Icon', props),
    IconButton: ({ children, ...props }: { children?: React.ReactNode }) =>
      React.createElement('IconButton', props, children),
    Input: (props: Record<string, unknown>) => React.createElement('Input', props),
    Switch: (props: Record<string, unknown>) => React.createElement('Switch', props),
    Tag: ({ children, ...props }: { children?: React.ReactNode }) =>
      React.createElement('Tag', props, children),
    Textarea: (props: Record<string, unknown>) => React.createElement('Textarea', props),
    VerdictPicker: (props: Record<string, unknown>) =>
      React.createElement('VerdictPicker', props),
    VerdictStamp: (props: Record<string, unknown>) =>
      React.createElement('VerdictStamp', props),
  }
})

const mockedGetTaste = jest.mocked(getTaste)
const mockedUpdateTaste = jest.mocked(updateTaste)

function taste(overrides: Partial<Taste> = {}): Taste {
  return {
    id: 'taste-1',
    name: 'Espresso',
    place: 'Corner Cafe',
    price: '$4.00',
    status: 'tasted',
    verdict: 'yum',
    tags: ['Coffee'],
    boughtCount: 1,
    warnBeforeBuy: false,
    purchases: [],
    date: 'today',
    notes: 'Too bitter',
    image: '',
    imageThumb: '',
    imageDisplay: '',
    imageKey: '',
    createdAt: '2026-06-08T00:00:00.000Z',
    ...overrides,
  }
}

async function renderDetail(): Promise<TestRenderer.ReactTestRenderer> {
  let renderer!: TestRenderer.ReactTestRenderer
  await act(async () => {
    renderer = TestRenderer.create(<DetailView />)
  })
  return renderer
}

function buttons(renderer: TestRenderer.ReactTestRenderer) {
  return renderer.root.findAll((node) => (node.type as unknown) === 'Button')
}

function inputByLabel(renderer: TestRenderer.ReactTestRenderer, label: string) {
  return renderer.root.findAll((node) => (node.type as unknown) === 'Input')
    .find((node) => node.props.label === label)
}

function editHeader(renderer: TestRenderer.ReactTestRenderer) {
  return renderer.root.findAll((node) => (node.type as unknown) === 'EditActionHeader')[0]
}

describe('DetailView editing', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('opens editable fields when Edit is tapped', async () => {
    mockedGetTaste.mockResolvedValueOnce(taste())
    const renderer = await renderDetail()

    const edit = buttons(renderer).find((button) => button.children.includes('edit'))
    expect(edit?.props.onPress).toEqual(expect.any(Function))

    await act(async () => {
      edit?.props.onPress()
    })

    const nameInput = inputByLabel(renderer, 'f_what')
    expect(nameInput).toBeTruthy()
    expect(nameInput?.props.value).toBe('Espresso')
  })

  // Regression: editing a taste showed a large dead gap above the form because
  // the content wrapper kept the read-mode paddingTop:36 (which exists to clear
  // the verdict stamp hanging below the hero image). In edit mode the hero block
  // + stamp are hidden, so the top pad must drop to the standard 20 to match
  // AddModal / the other editors.
  it('uses the standard top padding in edit mode (no dead whitespace above the form)', async () => {
    mockedGetTaste.mockResolvedValueOnce(taste())
    const renderer = await renderDetail()

    // Read mode keeps 36 to clear the verdict stamp.
    const readContent = renderer.root.findByProps({ testID: 'detail-content' })
    expect((readContent.props.style as { paddingTop: number }).paddingTop).toBe(36)

    const edit = buttons(renderer).find((button) => button.children.includes('edit'))
    await act(async () => {
      edit?.props.onPress()
    })

    // Edit mode drops to 20 (hero + stamp gone) — fails against the old always-36.
    const editContent = renderer.root.findByProps({ testID: 'detail-content' })
    expect((editContent.props.style as { paddingTop: number }).paddingTop).toBe(20)
  })

  it('saves edited detail fields through updateTaste and returns to read mode', async () => {
    mockedGetTaste.mockResolvedValueOnce(taste())
    mockedUpdateTaste.mockResolvedValueOnce(taste({ name: 'Cortado', notes: 'Better now' }))
    const renderer = await renderDetail()

    const edit = buttons(renderer).find((button) => button.children.includes('edit'))
    await act(async () => {
      edit?.props.onPress()
    })

    const nameInput = inputByLabel(renderer, 'f_what')
    await act(async () => {
      nameInput?.props.onChangeText('Cortado')
    })

    const notes = renderer.root.find((node) => (node.type as unknown) === 'Textarea')
    await act(async () => {
      notes.props.onChangeText('Better now')
    })

    await act(async () => {
      await editHeader(renderer).props.onPrimary()
    })

    expect(mockedUpdateTaste).toHaveBeenCalledWith('taste-1', {
      name: 'Cortado',
      place: 'Corner Cafe',
      price: '4.00',
      verdict: 'yum',
      tags: ['Coffee'],
      notes: 'Better now',
      // The pin rides along every save (null here — the fixture has no coords).
      lat: null,
      lng: null,
    })
    expect(inputByLabel(renderer, 'f_what')).toBeUndefined()
    expect(renderer.root.findAll((node) => node.children.includes('Cortado'))).not.toHaveLength(0)
  })

  // Regression: editing a taste used to DROP its coordinates entirely — the
  // edit PATCH never carried lat/lng, so the server (which now persists them)
  // would have nothing to write and a re-save could orphan the pin. A taste
  // opened for edit must round-trip its existing pin through the save payload
  // so editing the name/notes never silently loses the physical location.
  it('preserves the existing lat/lng pin in the save payload', async () => {
    mockedGetTaste.mockResolvedValueOnce(taste({ lat: 31.2304, lng: 121.4737 }))
    mockedUpdateTaste.mockResolvedValueOnce(taste({ lat: 31.2304, lng: 121.4737, name: 'Latte' }))
    const renderer = await renderDetail()

    const edit = buttons(renderer).find((button) => button.children.includes('edit'))
    await act(async () => { edit?.props.onPress() })

    const nameInput = inputByLabel(renderer, 'f_what')
    await act(async () => { nameInput?.props.onChangeText('Latte') })

    await act(async () => { await editHeader(renderer).props.onPrimary() })

    const [, payload] = mockedUpdateTaste.mock.calls[0]
    expect(payload.lat).toBe(31.2304)
    expect(payload.lng).toBe(121.4737)
  })

  // The "定位地址" pin row renders in edit mode (below the place-nickname input)
  // so the user can see/clear the pin even on platforms without the map picker.
  it('renders the location pin row in edit mode', async () => {
    mockedGetTaste.mockResolvedValueOnce(taste({ lat: 31.2304, lng: 121.4737 }))
    const renderer = await renderDetail()

    const edit = buttons(renderer).find((button) => button.children.includes('edit'))
    await act(async () => { edit?.props.onPress() })

    expect(
      renderer.root.findAll((node) => node.props.testID === 'location-pin-row'),
    ).not.toHaveLength(0)
  })

  it('shows the rating picker when editing a tasted item', async () => {
    mockedGetTaste.mockResolvedValueOnce(taste()) // status: 'tasted'
    const renderer = await renderDetail()

    const edit = buttons(renderer).find((button) => button.children.includes('edit'))
    await act(async () => { edit?.props.onPress() })

    expect(
      renderer.root.findAll((node) => (node.type as unknown) === 'VerdictPicker'),
    ).not.toHaveLength(0)
  })

  it('hides the rating picker when editing a todo item', async () => {
    // Todo rows have not been eaten yet — editing them must not show a verdict
    // picker (parity with AddModal todo mode); rating happens on promote.
    mockedGetTaste.mockResolvedValueOnce(taste({ status: 'todo', verdict: null }))
    const renderer = await renderDetail()

    const edit = buttons(renderer).find((button) => button.children.includes('edit'))
    await act(async () => { edit?.props.onPress() })

    // Edit fields are open (name field present) ...
    expect(inputByLabel(renderer, 'f_what')).toBeTruthy()
    // ... but the rating picker is not rendered.
    expect(
      renderer.root.findAll((node) => (node.type as unknown) === 'VerdictPicker'),
    ).toHaveLength(0)
  })

  it('omits verdict in the PATCH when saving a todo edit', async () => {
    mockedGetTaste.mockResolvedValueOnce(taste({ status: 'todo', verdict: null }))
    mockedUpdateTaste.mockResolvedValueOnce(taste({ status: 'todo', verdict: null, name: 'Oat Latte' }))
    const renderer = await renderDetail()

    const edit = buttons(renderer).find((button) => button.children.includes('edit'))
    await act(async () => { edit?.props.onPress() })

    const nameInput = inputByLabel(renderer, 'f_what')
    await act(async () => { nameInput?.props.onChangeText('Oat Latte') })

    await act(async () => { await editHeader(renderer).props.onPrimary() })

    expect(mockedUpdateTaste).toHaveBeenCalledTimes(1)
    const [, payload] = mockedUpdateTaste.mock.calls[0]
    expect(payload).not.toHaveProperty('verdict')
    expect(payload.name).toBe('Oat Latte')
  })

  it('renders the unified EditActionHeader: cancel→cancelEditing, primary→saveEdit, disabled when name empty', async () => {
    mockedGetTaste.mockResolvedValueOnce(taste())
    mockedUpdateTaste.mockResolvedValueOnce(taste())
    const renderer = await renderDetail()

    const edit = buttons(renderer).find((button) => button.children.includes('edit'))
    await act(async () => { edit?.props.onPress() })

    // The unified top action header replaced the old bottom right-aligned footer.
    expect(
      renderer.root.findAll((node) => node.props.testID === 'edit-actions-footer'),
    ).toHaveLength(0)

    const header = editHeader(renderer)
    expect(header).toBeTruthy()
    // It carries the save command on the right (primaryTestID kept for callers).
    expect(header.props.primaryTestID).toBe('edit-save-btn')
    expect(header.props.primaryLabel).toBe('save_taste_web')
    expect(header.props.cancelLabel).toBe('cancel')
    expect(header.props.title).toBe('edit_taste')
    // Enabled because the loaded taste has a name.
    expect(header.props.primaryDisabled).toBe(false)

    // Primary fires saveEdit (calls updateTaste).
    await act(async () => { await header.props.onPrimary() })
    expect(mockedUpdateTaste).toHaveBeenCalledWith('taste-1', expect.objectContaining({ name: 'Espresso' }))

    // After saving we are back in read mode (no header, edit fields gone).
    expect(renderer.root.findAll((node) => (node.type as unknown) === 'EditActionHeader')).toHaveLength(0)
    expect(inputByLabel(renderer, 'f_what')).toBeUndefined()
  })

  it('cancel on the EditActionHeader leaves edit mode immediately when not dirty', async () => {
    mockedGetTaste.mockResolvedValueOnce(taste())
    const renderer = await renderDetail()

    const edit = buttons(renderer).find((button) => button.children.includes('edit'))
    await act(async () => { edit?.props.onPress() })
    expect(inputByLabel(renderer, 'f_what')).toBeTruthy()

    // Cancel without changing anything — not dirty, exits directly, no confirm sheet.
    await act(async () => { editHeader(renderer).props.onCancel() })
    // Back to read mode: header gone, edit fields gone.
    expect(renderer.root.findAll((node) => (node.type as unknown) === 'EditActionHeader')).toHaveLength(0)
    expect(inputByLabel(renderer, 'f_what')).toBeUndefined()
    // Confirm sheet must not have been shown (visible stays false).
    const confirmSheet = renderer.root.findAll(
      (node) => node.props.testID === 'detail-cancel-confirm',
    )
    expect(confirmSheet.every((n) => n.props.visible === false)).toBe(true)
  })

  it('cancel on a dirty edit shows the discard confirm sheet; confirming exits edit mode', async () => {
    mockedGetTaste.mockResolvedValueOnce(taste())
    const renderer = await renderDetail()

    const edit = buttons(renderer).find((button) => button.children.includes('edit'))
    await act(async () => { edit?.props.onPress() })

    // Make the form dirty by changing the name field.
    const nameInput = inputByLabel(renderer, 'f_what')
    await act(async () => { nameInput?.props.onChangeText('Dirty Name') })

    // Cancel — dirty, so the confirm sheet should open.
    await act(async () => { editHeader(renderer).props.onCancel() })

    const confirmSheet = renderer.root.find(
      (node) => node.props.testID === 'detail-cancel-confirm',
    )
    expect(confirmSheet.props.visible).toBe(true)
    // Still in edit mode (name input still present).
    expect(inputByLabel(renderer, 'f_what')).toBeTruthy()

    // Tap the destructive confirm button → discards and exits edit mode.
    await act(async () => { confirmSheet.props.onConfirm() })
    expect(renderer.root.findAll((node) => (node.type as unknown) === 'EditActionHeader')).toHaveLength(0)
    expect(inputByLabel(renderer, 'f_what')).toBeUndefined()
  })

  it('disables the primary command when the name is cleared', async () => {
    mockedGetTaste.mockResolvedValueOnce(taste())
    const renderer = await renderDetail()

    const edit = buttons(renderer).find((button) => button.children.includes('edit'))
    await act(async () => { edit?.props.onPress() })

    expect(editHeader(renderer).props.primaryDisabled).toBe(false)
    const nameInput = inputByLabel(renderer, 'f_what')
    await act(async () => { nameInput?.props.onChangeText('') })
    expect(editHeader(renderer).props.primaryDisabled).toBe(true)
  })

  // Regression: double top safe-area inset in edit mode.
  // Before the fix the route container applied paddingTop:insets.top AND
  // EditActionHeader applied insets.top+12, yielding 2×inset+12 of dead space
  // above the header. The fix moves ALL inset responsibility into DetailView
  // itself: read mode applies it once on the OUTER (non-positioned) photo
  // wrapper, edit mode relies entirely on EditActionHeader (no extra padding
  // from the route or DetailView). StyleSheet.flatten() is used so the
  // assertion works whether style is an object or an array.
  it('read mode applies paddingTop:insets.top on the photo wrapper; edit mode does not', async () => {
    mockedGetTaste.mockResolvedValueOnce(taste())
    const renderer = await renderDetail()

    // READ MODE: the outer photo wrapper must carry exactly insets.top (47).
    const photoWrapper = renderer.root.findByProps({ testID: 'detail-read-photo-wrapper' })
    expect(StyleSheet.flatten(photoWrapper.props.style).paddingTop).toBe(47)

    // Switch to EDIT MODE.
    const edit = buttons(renderer).find((button) => button.children.includes('edit'))
    await act(async () => { edit?.props.onPress() })

    // EDIT MODE: the photo wrapper is gone (hidden) — EditActionHeader self-insets.
    expect(
      renderer.root.findAll((node) => node.props.testID === 'detail-read-photo-wrapper'),
    ).toHaveLength(0)

    // The edit content wrapper must NOT carry a paddingTop equal to insets.top;
    // that would re-introduce the double-inset above the EditActionHeader.
    const editContent = renderer.root.findByProps({ testID: 'detail-content' })
    const editContentPadTop = StyleSheet.flatten(editContent.props.style).paddingTop
    expect(editContentPadTop).not.toBe(47)
    expect(editContentPadTop).not.toBe(47 + 12)
  })
})
