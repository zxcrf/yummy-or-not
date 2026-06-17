/* ============================================================
   Regression test — DetailView delete confirm dialog (task #5).

   Bug: the 删除 button triggered a native Alert.alert, inconsistent
   with the app's Newtro design and untestable in Jest.

   Fix: handleDelete now opens an in-app Modal sheet (confirmDeleteOpen)
   mirroring the promote/buy-again sheets already in this file.

   Pins:
   1. Pressing 删除 renders the in-app confirm sheet, NOT Alert.alert.
   2. The confirm sheet shows the title (t('del')) and body (t('confirm_delete')).
   3. Pressing confirm-delete-btn calls deleteTaste and does NOT call Alert.alert.
   4. Pressing cancel closes the sheet without deleting.
   ============================================================ */

import TestRenderer, { act } from 'react-test-renderer'
import DetailView from '../DetailView'

// ---- mock react-native ----------------------------------------------------

const mockAlert = jest.fn()

jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native')
  return new Proxy(actual, {
    get(target, prop, receiver) {
      if (prop === 'Alert') return { alert: mockAlert }
      if (prop === 'Modal') {
        return ({
          visible,
          children,
          testID,
        }: {
          visible: boolean
          children: React.ReactNode
          testID?: string
        }) =>
          visible ? (
            <div data-testid={testID ?? 'modal'}>{children}</div>
          ) : null
      }
      if (prop === 'Pressable') {
        return ({
          children,
          onPress,
          testID,
        }: {
          children: React.ReactNode | ((state: { pressed: boolean }) => React.ReactNode)
          onPress?: () => void
          testID?: string
        }) => (
          <div data-testid={testID} onClick={onPress}>
            {typeof children === 'function' ? children({ pressed: false }) : children}
          </div>
        )
      }
      if (prop === 'StyleSheet') return { create: (s: unknown) => s }
      if (prop === 'Platform') return { OS: 'ios' }
      if (prop === 'ActivityIndicator') return () => null
      if (prop === 'Image') return () => null
      if (prop === 'ScrollView') {
        return ({ children }: { children: React.ReactNode }) => <div>{children}</div>
      }
      return Reflect.get(target, prop, receiver)
    },
  })
})

// ---- mock shared ----------------------------------------------------------

const mockDeleteTaste = jest.fn()

jest.mock('@yon/shared', () => ({
  TAG_CHOICES: [],
  getTaste: jest.fn().mockResolvedValue(null),
  updateTaste: jest.fn(),
  deleteTaste: (...args: unknown[]) => mockDeleteTaste(...args),
  addPurchase: jest.fn(),
  getOriginalPhotoUrl: jest.fn(),
  getTags: jest.fn().mockResolvedValue([]),
  ProRequiredError: class ProRequiredError extends Error {
    constructor() { super('pro_required'); this.name = 'ProRequiredError' }
  },
}))

// ---- mock _useTastes ------------------------------------------------------

const mockInvalidateTastes = jest.fn()
jest.mock('@/app/(tabs)/_useTastes', () => {
  // Inline fixtures — jest hoists this factory above all variable declarations,
  // so any module-scope fixture cannot be referenced here by name.
  const base = {
    id: 'taste-1', name: 'Spicy Ramen', place: 'Ramen Bar', price: '12.00',
    status: 'tasted', verdict: 'yum', tags: [], boughtCount: 1,
    warnBeforeBuy: false, purchases: [], date: '2026-01-01',
    createdAt: '2026-01-01T00:00:00.000Z', notes: '',
    image: '', imageThumb: '', imageDisplay: '', imageKey: '',
  }
  return {
    getCachedTaste: (id: string) => {
      if (id === 'taste-1') return base
      if (id === 'taste-2') return { ...base, id: 'taste-2', name: 'Tonkotsu Ramen' }
      return undefined
    },
    invalidateTastes: () => mockInvalidateTastes(),
  }
})

// ---- mock _useTags --------------------------------------------------------

jest.mock('@/app/(tabs)/_useTags', () => ({
  useTags: () => ({ tags: [] }),
}))

// ---- mock expo-router -----------------------------------------------------

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'taste-1' }),
  useRouter: () => ({ back: jest.fn(), push: jest.fn(), replace: jest.fn() }),
}))

// ---- mock expo-image ------------------------------------------------------

jest.mock('expo-image', () => ({ Image: () => null }))

// ---- mock expo-sharing ----------------------------------------------------

jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn().mockResolvedValue(false),
  shareAsync: jest.fn(),
}))

// ---- mock react-native-view-shot ------------------------------------------

jest.mock('react-native-view-shot', () => ({ captureRef: jest.fn() }))

// ---- mock providers -------------------------------------------------------

jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'u1', plan: 'free' } }),
}))

jest.mock('@/providers/I18nProvider', () => ({
  useI18n: () => ({
    t: (key: string) =>
      ({
        del: 'Delete',
        confirm_delete: "Delete this taste? This can't be undone.",
        cancel: 'Cancel',
        promote_title: 'Promote',
        promote_confirm: 'Confirm',
        pro_plan: 'Pro',
        taste_limit_reached: 'Limit',
        nothing_here: 'Nothing',
        share_failed: 'Share failed',
        f_price: 'Price',
      }[key] ?? key),
    formatMoney: (v: string) => v,
  }),
}))

// ---- mock ShareCard -------------------------------------------------------

jest.mock('@/components/app/ShareCard', () => ({ ShareCard: () => null }))

// ---- mock DS components ---------------------------------------------------

jest.mock('@/components/ds', () => ({
  ConfirmSheet: () => null,
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Button: ({
    children,
    onPress,
    testID,
    disabled,
  }: {
    children: React.ReactNode
    onPress?: () => void
    testID?: string
    disabled?: boolean
  }) => (
    <button data-testid={testID} onClick={onPress} disabled={disabled}>
      {children}
    </button>
  ),
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Icon: () => null,
  IconButton: ({ onPress, testID }: { onPress?: () => void; testID?: string }) => (
    <button data-testid={testID} onClick={onPress} />
  ),
  Input: () => null,
  Switch: () => null,
  Tag: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Textarea: () => null,
  VerdictPicker: () => null,
  VerdictStamp: () => null,
}))

// ---- helpers (matches existing DetailView test conventions) ---------------

function findByTestId(renderer: TestRenderer.ReactTestRenderer, testId: string) {
  return renderer.root.findAll((n) => n.props['data-testid'] === testId)
}

const mountedRenderers: TestRenderer.ReactTestRenderer[] = []

afterEach(() => {
  act(() => { mountedRenderers.forEach((r) => r.unmount()) })
  mountedRenderers.length = 0
})

async function renderDetail(): Promise<TestRenderer.ReactTestRenderer> {
  let renderer!: TestRenderer.ReactTestRenderer
  await act(async () => {
    renderer = TestRenderer.create(<DetailView />)
  })
  mountedRenderers.push(renderer)
  return renderer
}

// ---- tests ----------------------------------------------------------------

beforeEach(() => {
  mockAlert.mockClear()
  mockDeleteTaste.mockClear()
  mockInvalidateTastes.mockClear()
  mockDeleteTaste.mockResolvedValue(undefined)
})

describe('DetailView delete confirm dialog', () => {
  it('pressing 删除 opens the in-app confirm sheet, NOT Alert.alert', async () => {
    const renderer = await renderDetail()

    // Confirm sheet must not be visible before pressing delete.
    expect(findByTestId(renderer, 'confirm-delete-modal')).toHaveLength(0)

    // Press the delete button.
    act(() => {
      findByTestId(renderer, 'delete-btn')[0].props.onClick()
    })

    // Sheet is now visible.
    expect(findByTestId(renderer, 'confirm-delete-modal')).toHaveLength(1)

    // Alert.alert must NOT have been called — the entire point of this fix.
    expect(mockAlert).not.toHaveBeenCalled()
  })

  it('confirm sheet renders the title and body text', async () => {
    const renderer = await renderDetail()

    act(() => {
      findByTestId(renderer, 'delete-btn')[0].props.onClick()
    })

    const serialized = JSON.stringify(renderer.toJSON())
    expect(serialized).toContain('Delete')
    expect(serialized).toContain("Delete this taste? This can't be undone.")
  })

  it('pressing confirm-delete-btn calls deleteTaste and does not call Alert.alert', async () => {
    const renderer = await renderDetail()

    act(() => {
      findByTestId(renderer, 'delete-btn')[0].props.onClick()
    })

    await act(async () => {
      findByTestId(renderer, 'confirm-delete-btn')[0].props.onClick()
    })

    expect(mockDeleteTaste).toHaveBeenCalledWith('taste-1')
    expect(mockAlert).not.toHaveBeenCalled()
  })

  it('id change closes the delete sheet so confirm cannot delete the wrong record', async () => {
    const renderer = await renderDetail()

    // Open the confirm sheet for taste-1.
    act(() => {
      findByTestId(renderer, 'delete-btn')[0].props.onClick()
    })
    expect(findByTestId(renderer, 'confirm-delete-modal')).toHaveLength(1)

    // Simulate the router delivering a new id (taste-2) to the same instance.
    const ExpoRouter = jest.requireMock('expo-router') as {
      useLocalSearchParams: () => { id: string }
    }
    ;(ExpoRouter as Record<string, unknown>).useLocalSearchParams = () => ({ id: 'taste-2' })
    act(() => {
      renderer.update(<DetailView />)
    })

    // Sheet must be gone — the id-change reset closed it.
    expect(findByTestId(renderer, 'confirm-delete-modal')).toHaveLength(0)

    // And if somehow the confirm button were pressed now, it must not delete taste-1.
    expect(mockDeleteTaste).not.toHaveBeenCalled()
  })

  it('pressing cancel closes the sheet without deleting', async () => {
    const renderer = await renderDetail()

    act(() => {
      findByTestId(renderer, 'delete-btn')[0].props.onClick()
    })

    // Sheet open — find cancel button inside the modal (the ghost "Cancel" button).
    const modalNodes = findByTestId(renderer, 'confirm-delete-modal')
    expect(modalNodes).toHaveLength(1)
    const cancelBtns = modalNodes[0].findAll(
      (n) => n.type === 'button' && JSON.stringify(n.children).includes('Cancel'),
    )
    expect(cancelBtns).toHaveLength(1)

    act(() => {
      cancelBtns[0].props.onClick()
    })

    // Sheet must be gone.
    expect(findByTestId(renderer, 'confirm-delete-modal')).toHaveLength(0)
    expect(mockDeleteTaste).not.toHaveBeenCalled()
  })
})
