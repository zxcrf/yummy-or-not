/* ============================================================
   Regression tests — TasterManageView (S3b persona CRUD UI).

   Pins:
   - PRO: create calls createTaster with the entered payload, then
     invalidateTasters() (so the shared _useTasters cache — the one
     TasterSwitcher subscribes to — refetches and the switcher updates).
   - PRO: rename calls updateTaster(id, …); delete confirm calls
     deleteTaster(id) + invalidateTasters().
   - The self-taster is marked and exposes NO delete control (undeletable
     in the UI — defense in depth; server protects it too).
   - FREE plan renders the upgrade gate and NO management actions
     (no add button, no per-row edit/delete controls).
   - 403 'pro_required' on create surfaces the upgrade gate instead of
     crashing.
   ============================================================ */

import TestRenderer, { act } from 'react-test-renderer'
import { Alert } from 'react-native'

// Identifiable KeyboardStickyView wrapper (shared setup aliases it to a bare
// View). Not asserted here but keeps the sheet structure intact.
jest.mock('react-native-keyboard-controller', () => {
  const React = require('react')
  const { View } = require('react-native')
  return {
    KeyboardStickyView: ({ children }: { children: React.ReactNode }) =>
      React.createElement(View, { testID: 'taster-keyboard-sticky' }, children),
  }
})

const mockCreateTaster = jest.fn()
const mockUpdateTaster = jest.fn()
const mockDeleteTaster = jest.fn()
const mockInvalidateTasters = jest.fn()
const mockUseAuth = jest.fn()

const SELF = { id: 't-self', displayName: 'Me', avatar: '', isSelf: true }
const PARTNER = { id: 't-partner', displayName: 'Partner', avatar: '', isSelf: false }

jest.mock('@yon/shared', () => ({
  createTaster: (...args: unknown[]) => mockCreateTaster(...args),
  updateTaster: (...args: unknown[]) => mockUpdateTaster(...args),
  deleteTaster: (...args: unknown[]) => mockDeleteTaster(...args),
}))

jest.mock('@/app/(tabs)/_useTasters', () => ({
  useTasters: () => ({ tasters: [SELF, PARTNER], loading: false }),
  invalidateTasters: (...args: unknown[]) => mockInvalidateTasters(...args),
}))

jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => mockUseAuth(),
}))

jest.mock('@/providers/I18nProvider', () => ({
  useI18n: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        cancel: 'Cancel',
        del: 'Delete',
        edit_profile: 'Edit',
        save_taste: 'Save',
        taster_add: 'Add taster',
        taster_create: 'New taster',
        taster_manage: 'Tasters',
        taster_self: 'You',
        taster_name_label: 'Name',
        taster_avatar_label: 'Avatar',
        taster_pro_required: 'Tasters is a Pro feature',
        taster_invalid_name: 'Invalid name',
        taster_delete_confirm: 'Delete this taster?',
        taster_empty: 'No tasters',
      }
      return map[key] ?? key
    },
  }),
}))

import TasterManageView from '../TasterManageView'

const mountedRenderers: TestRenderer.ReactTestRenderer[] = []

function render(): TestRenderer.ReactTestRenderer {
  let renderer!: TestRenderer.ReactTestRenderer
  act(() => {
    renderer = TestRenderer.create(<TasterManageView />)
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

describe('TasterManageView — pro CRUD', () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({ user: { id: 'u1', plan: 'pro' } })
  })

  it('create calls createTaster with the entered payload then invalidateTasters', async () => {
    mockCreateTaster.mockResolvedValueOnce({ id: 't-new', displayName: 'Kid', avatar: '', isSelf: false })
    const renderer = render()

    act(() => {
      renderer.root.findByProps({ testID: 'add-taster-btn' }).props.onPress()
    })
    act(() => {
      renderer.root.findByProps({ testID: 'taster-name-input' }).props.onChangeText('Kid')
    })

    await act(async () => {
      await renderer.root.findByProps({ testID: 'taster-save-btn' }).props.onPress()
    })

    expect(mockCreateTaster).toHaveBeenCalledWith({ displayName: 'Kid', avatar: undefined })
    // Shared cache refetch so TasterSwitcher (same _useTasters source) updates.
    expect(mockInvalidateTasters).toHaveBeenCalled()
  })

  it('rename calls updateTaster(id, …) then invalidateTasters', async () => {
    mockUpdateTaster.mockResolvedValueOnce({ ...PARTNER, displayName: 'Spouse' })
    const renderer = render()

    act(() => {
      renderer.root.findByProps({ testID: 'edit-taster-t-partner' }).props.onPress()
    })
    act(() => {
      renderer.root.findByProps({ testID: 'taster-name-input' }).props.onChangeText('Spouse')
    })

    await act(async () => {
      await renderer.root.findByProps({ testID: 'taster-save-btn' }).props.onPress()
    })

    expect(mockUpdateTaster).toHaveBeenCalledWith('t-partner', { displayName: 'Spouse', avatar: '' })
    expect(mockInvalidateTasters).toHaveBeenCalled()
  })

  it('delete confirm path calls deleteTaster(id) and invalidateTasters', async () => {
    mockDeleteTaster.mockResolvedValueOnce(undefined)
    let destructiveOnPress: (() => Promise<void>) | undefined
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _msg, buttons) => {
      const btn = (buttons ?? []).find((b) => b.style === 'destructive')
      destructiveOnPress = btn?.onPress as (() => Promise<void>) | undefined
    })

    const renderer = render()
    act(() => {
      renderer.root.findByProps({ testID: 'delete-taster-t-partner' }).props.onPress()
    })

    await act(async () => {
      await destructiveOnPress?.()
    })

    expect(mockDeleteTaster).toHaveBeenCalledWith('t-partner')
    expect(mockInvalidateTasters).toHaveBeenCalled()
    jest.restoreAllMocks()
  })

  it('self-taster is marked and exposes no delete control', () => {
    const renderer = render()
    // self row is labelled
    expect(renderer.root.findByProps({ testID: 'taster-self-t-self' })).toBeTruthy()
    // self row has NO delete control; the partner row does. Match the pressable
    // (onPress present) so host/instance duplicates of the same testID collapse
    // to the single logical control.
    const selfDelete = renderer.root.findAll(
      (n) => n.props.testID === 'delete-taster-t-self' && typeof n.props.onPress === 'function',
    )
    const partnerDelete = renderer.root.findAll(
      (n) => n.props.testID === 'delete-taster-t-partner' && typeof n.props.onPress === 'function',
    )
    expect(selfDelete).toHaveLength(0)
    expect(partnerDelete).toHaveLength(1)
  })

  it('403 pro_required on create surfaces the upgrade gate, not a crash', async () => {
    mockCreateTaster.mockRejectedValueOnce(new Error('pro_required'))
    const renderer = render()

    act(() => {
      renderer.root.findByProps({ testID: 'add-taster-btn' }).props.onPress()
    })
    act(() => {
      renderer.root.findByProps({ testID: 'taster-name-input' }).props.onChangeText('Kid')
    })

    await act(async () => {
      await renderer.root.findByProps({ testID: 'taster-save-btn' }).props.onPress()
    })

    // Upgrade gate is shown; the create was NOT treated as success.
    expect(renderer.root.findByProps({ testID: 'taster-pro-gate' })).toBeTruthy()
    expect(mockInvalidateTasters).not.toHaveBeenCalled()
  })
})

describe('TasterManageView — free plan gating', () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({ user: { id: 'u1', plan: 'free' } })
  })

  it('renders the upgrade gate and no management actions', () => {
    const renderer = render()
    expect(renderer.root.findByProps({ testID: 'taster-pro-gate' })).toBeTruthy()
    // No add button and no per-row edit/delete controls for free users.
    expect(renderer.root.findAllByProps({ testID: 'add-taster-btn' })).toHaveLength(0)
    expect(renderer.root.findAllByProps({ testID: 'edit-taster-t-partner' })).toHaveLength(0)
    expect(renderer.root.findAllByProps({ testID: 'delete-taster-t-partner' })).toHaveLength(0)
  })
})
