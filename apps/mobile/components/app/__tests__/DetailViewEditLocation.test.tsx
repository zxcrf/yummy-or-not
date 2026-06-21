/* ============================================================
   Wiring tests — confirming a map pin in DetailView edit mode.

   The map picker is mocked to a prop-capturing stub so we can drive its
   onConfirm directly (the native map can't mount here). What matters is the
   wiring on the DetailView side, which is identical on every platform and would
   otherwise only be exercised on-device: a confirmed pin must reach the PATCH
   payload as lat/lng, must seed the place NICKNAME only when it is empty (never
   clobber a name the user typed), and the clear affordance must null the pin.
   ============================================================ */

import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { getTaste, updateTaste, type Taste } from '@yon/shared'

import DetailView from '../DetailView'

// Capture the props the (mocked) LocationPicker is rendered with, so the test
// can invoke onConfirm exactly as the real picker would on a confirmed pick.
const mockPicker = { props: null as null | Record<string, unknown> }
jest.mock('../LocationPicker', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    mockPicker.props = props
    return null
  },
}))

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 47, bottom: 0, left: 0, right: 0 }),
}))

jest.mock('@yon/shared', () => ({
  TAG_CHOICES: ['Coffee', 'Dessert'],
  deleteTaste: jest.fn(),
  getTaste: jest.fn(),
  updateTaste: jest.fn(),
}))

jest.mock('@/app/(tabs)/_useTastes', () => ({
  invalidateTastes: jest.fn(async () => []),
  getCachedTaste: jest.fn(() => undefined),
}))

jest.mock('@/app/(tabs)/_useTags', () => ({
  useTags: () => ({ tags: [], loading: false }),
  invalidateTagsCache: jest.fn(),
}))

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'taste-1' }),
  useRouter: () => ({ back: jest.fn(), canGoBack: jest.fn(() => true), replace: jest.fn() }),
}))

jest.mock('@/providers/I18nProvider', () => ({
  useI18n: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values && values.n != null ? `${key}:${values.n}` : key,
    formatMoney: (amount: number | string) => {
      const n = typeof amount === 'number' ? amount : Number.parseFloat(String(amount).replace(/[^0-9.]/g, ''))
      return Number.isFinite(n) ? `$${n}` : ''
    },
  }),
}))

jest.mock('@/components/ds', () => {
  const React = require('react')
  return {
    Badge: ({ children, ...props }: { children?: React.ReactNode }) => React.createElement('Badge', props, children),
    Button: ({ children, ...props }: { children?: React.ReactNode }) => React.createElement('Button', props, children),
    Card: ({ children, ...props }: { children?: React.ReactNode }) => React.createElement('Card', props, children),
    ConfirmSheet: (props: Record<string, unknown>) => React.createElement('ConfirmSheet', props),
    EditActionHeader: (props: Record<string, unknown>) => React.createElement('EditActionHeader', props),
    Icon: (props: Record<string, unknown>) => React.createElement('Icon', props),
    IconButton: ({ children, ...props }: { children?: React.ReactNode }) => React.createElement('IconButton', props, children),
    Input: (props: Record<string, unknown>) => React.createElement('Input', props),
    Switch: (props: Record<string, unknown>) => React.createElement('Switch', props),
    Tag: ({ children, ...props }: { children?: React.ReactNode }) => React.createElement('Tag', props, children),
    Textarea: (props: Record<string, unknown>) => React.createElement('Textarea', props),
    VerdictPicker: (props: Record<string, unknown>) => React.createElement('VerdictPicker', props),
    VerdictStamp: (props: Record<string, unknown>) => React.createElement('VerdictStamp', props),
  }
})

const mockedGetTaste = jest.mocked(getTaste)
const mockedUpdateTaste = jest.mocked(updateTaste)

function taste(overrides: Partial<Taste> = {}): Taste {
  return {
    id: 'taste-1', name: 'Espresso', place: 'Corner Cafe', price: '$4.00', status: 'tasted',
    verdict: 'yum', tags: ['Coffee'], boughtCount: 1, warnBeforeBuy: false, purchases: [],
    date: 'today', notes: '', image: '', imageThumb: '', imageDisplay: '', imageKey: '',
    createdAt: '2026-06-08T00:00:00.000Z', ...overrides,
  }
}

const mounted: TestRenderer.ReactTestRenderer[] = []

async function renderDetail(): Promise<TestRenderer.ReactTestRenderer> {
  let renderer!: TestRenderer.ReactTestRenderer
  await act(async () => {
    renderer = TestRenderer.create(<DetailView />)
  })
  mounted.push(renderer)
  return renderer
}

function inputByLabel(renderer: TestRenderer.ReactTestRenderer, label: string) {
  return renderer.root.findAll((n) => (n.type as unknown) === 'Input').find((n) => n.props.label === label)
}
function editHeader(renderer: TestRenderer.ReactTestRenderer) {
  return renderer.root.findAll((n) => (n.type as unknown) === 'EditActionHeader')[0]
}
async function openEdit(renderer: TestRenderer.ReactTestRenderer) {
  const edit = renderer.root
    .findAll((n) => (n.type as unknown) === 'Button')
    .find((b) => b.children.includes('edit'))
  await act(async () => { edit?.props.onPress() })
}

describe('DetailView — map pin confirm wiring', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockPicker.props = null
  })

  afterEach(() => {
    act(() => { mounted.forEach((r) => r.unmount()) })
    mounted.length = 0
  })

  it('writes a confirmed pin into the PATCH payload', async () => {
    mockedGetTaste.mockResolvedValueOnce(taste({ place: 'Corner Cafe' }))
    mockedUpdateTaste.mockResolvedValueOnce(taste())
    const renderer = await renderDetail()
    await openEdit(renderer)

    // Picker is rendered (with visible=false) so its onConfirm is wired up.
    expect(mockPicker.props).not.toBeNull()
    const onConfirm = mockPicker.props!.onConfirm as (c: { lat: number; lng: number }, p: string | null) => void
    await act(async () => { onConfirm({ lat: 39.9087, lng: 116.3975 }, 'Beijing Cafe') })

    await act(async () => { await editHeader(renderer).props.onPrimary() })

    const [, payload] = mockedUpdateTaste.mock.calls[0]
    expect(payload.lat).toBe(39.9087)
    expect(payload.lng).toBe(116.3975)
    // place already had a value → the address must NOT overwrite the nickname.
    expect(payload.place).toBe('Corner Cafe')
  })

  it('seeds the empty place nickname from the picked address', async () => {
    mockedGetTaste.mockResolvedValueOnce(taste({ place: '' }))
    mockedUpdateTaste.mockResolvedValueOnce(taste())
    const renderer = await renderDetail()
    await openEdit(renderer)

    const onConfirm = mockPicker.props!.onConfirm as (c: { lat: number; lng: number }, p: string | null) => void
    await act(async () => { onConfirm({ lat: 39.9087, lng: 116.3975 }, 'Beijing Cafe') })

    // The nickname input reflects the seeded address immediately...
    expect(inputByLabel(renderer, 'f_where')?.props.value).toBe('Beijing Cafe')

    await act(async () => { await editHeader(renderer).props.onPrimary() })
    const [, payload] = mockedUpdateTaste.mock.calls[0]
    expect(payload.place).toBe('Beijing Cafe')
    expect(payload.lat).toBe(39.9087)
  })

  it('passes the current pin to the picker as its initial seed', async () => {
    // Platform-independent wiring: the picker's `initial` is derived from the
    // edited pin, so reopening on this taste centers the map on its location.
    mockedGetTaste.mockResolvedValueOnce(taste({ lat: 31.2304, lng: 121.4737 }))
    const renderer = await renderDetail()
    await openEdit(renderer)

    expect(mockPicker.props!.initial).toEqual({ lat: 31.2304, lng: 121.4737 })
  })

  it('passes a null seed to the picker when the taste has no pin', async () => {
    mockedGetTaste.mockResolvedValueOnce(taste({ lat: null, lng: null }))
    const renderer = await renderDetail()
    await openEdit(renderer)

    expect(mockPicker.props!.initial).toBeNull()
  })

  it('clears the pin to null through the row clear action', async () => {
    mockedGetTaste.mockResolvedValueOnce(taste({ lat: 31.2304, lng: 121.4737 }))
    mockedUpdateTaste.mockResolvedValueOnce(taste())
    const renderer = await renderDetail()
    await openEdit(renderer)

    const clear = renderer.root.findAllByProps({ testID: 'location-pin-clear' })[0]
    await act(async () => { clear.props.onPress() })

    await act(async () => { await editHeader(renderer).props.onPrimary() })
    const [, payload] = mockedUpdateTaste.mock.calls[0]
    expect(payload.lat).toBeNull()
    expect(payload.lng).toBeNull()
  })
})
