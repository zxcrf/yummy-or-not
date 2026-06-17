/* ============================================================
   Regression tests — warn-before-buy toggle and +1 Again sheet.

   Covers:
   - warn toggle seeded from item.warnBeforeBuy
   - toggle calls updateTaste({ warnBeforeBuy }) and optimistic-reverts on error
   - warn banner shown when remind=true AND user.warningsEnabled
   - warn banner hidden when remind=false or user.warningsEnabled=false
   - +1 Again button opens sheet prefilled from purchases[0] (or taste fallback)
   - confirm calls addPurchase with edited values and bumps boughtCount optimistically
   - boughtCount reverts on addPurchase error
   ============================================================ */

import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { addPurchase, getTaste, updateTaste, type Taste } from '@yon/shared'

import DetailView from '../DetailView'

jest.mock('@yon/shared', () => ({
  TAG_CHOICES: ['Coffee', 'Dessert'],
  deleteTaste: jest.fn(),
  getTaste: jest.fn(),
  updateTaste: jest.fn(),
  addPurchase: jest.fn(),
  getOriginalPhotoUrl: jest.fn(),
  ProRequiredError: class ProRequiredError extends Error {},
}))

jest.mock('@/app/(tabs)/_useTastes', () => ({
  invalidateTastes: jest.fn(async () => {}),
  getCachedTaste: jest.fn(() => undefined),
}))

jest.mock('@/app/(tabs)/_useTags', () => ({
  useTags: () => ({ tags: [], loading: false }),
  invalidateTagsCache: jest.fn(),
}))

let mockRouteId = 'taste-1'
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: mockRouteId }),
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
    formatMoney: (v: number | string) => String(v),
  }),
}))

// User with warningsEnabled=true by default; individual tests can override.
let mockUser: { plan: string; warningsEnabled: boolean } = {
  plan: 'free',
  warningsEnabled: true,
}

jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({ user: mockUser }),
}))

jest.mock('@/components/ds', () => {
  const React = require('react')
  return {
    ConfirmSheet: () => null,
    Badge: ({ children, ...p }: { children?: React.ReactNode }) => React.createElement('Badge', p, children),
    Button: ({ children, ...p }: { children?: React.ReactNode }) => React.createElement('Button', p, children),
    Card: ({ children, ...p }: { children?: React.ReactNode }) => React.createElement('Card', p, children),
    Icon: (p: Record<string, unknown>) => React.createElement('Icon', p),
    IconButton: ({ children, ...p }: { children?: React.ReactNode }) => React.createElement('IconButton', p, children),
    Input: (p: Record<string, unknown>) => React.createElement('Input', p),
    Switch: (p: Record<string, unknown>) => React.createElement('Switch', p),
    Tag: ({ children, ...p }: { children?: React.ReactNode }) => React.createElement('Tag', p, children),
    Textarea: (p: Record<string, unknown>) => React.createElement('Textarea', p),
    VerdictPicker: (p: Record<string, unknown>) => React.createElement('VerdictPicker', p),
    VerdictStamp: (p: Record<string, unknown>) => React.createElement('VerdictStamp', p),
  }
})

const mockedGetTaste = jest.mocked(getTaste)
const mockedUpdateTaste = jest.mocked(updateTaste)
const mockedAddPurchase = jest.mocked(addPurchase)

function taste(overrides: Partial<Taste> = {}): Taste {
  return {
    id: 'taste-1',
    name: 'Espresso',
    place: 'Corner Cafe',
    price: '4.00',
    status: 'tasted',
    verdict: 'yum',
    tags: ['Coffee'],
    boughtCount: 2,
    warnBeforeBuy: false,
    purchases: [],
    date: 'today',
    notes: '',
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

function switches(r: TestRenderer.ReactTestRenderer) {
  return r.root.findAll((n) => (n.type as unknown) === 'Switch')
}

describe('DetailView — warn toggle', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockRouteId = 'taste-1'
    mockUser = { plan: 'free', warningsEnabled: true }
  })

  it('seeds Switch from item.warnBeforeBuy=false', async () => {
    mockedGetTaste.mockResolvedValueOnce(taste({ warnBeforeBuy: false }))
    const r = await renderDetail()
    const sw = switches(r).find((n) => n.props.testID === undefined || n.props.testID !== 'warnings-switch')
    // The warn-before switch (no testID) should have checked=false
    expect(sw?.props.checked).toBe(false)
  })

  it('seeds Switch from item.warnBeforeBuy=true', async () => {
    mockedGetTaste.mockResolvedValueOnce(taste({ warnBeforeBuy: true }))
    mockedUpdateTaste.mockResolvedValue(taste({ warnBeforeBuy: true }))
    const r = await renderDetail()
    const sw = switches(r)[0]
    expect(sw?.props.checked).toBe(true)
  })

  it('calls updateTaste({ warnBeforeBuy: true }) when toggled on', async () => {
    mockedGetTaste.mockResolvedValueOnce(taste({ warnBeforeBuy: false }))
    mockedUpdateTaste.mockResolvedValueOnce(taste({ warnBeforeBuy: true }))
    const r = await renderDetail()
    const sw = switches(r)[0]
    await act(async () => {
      await sw.props.onChange(true)
    })
    expect(mockedUpdateTaste).toHaveBeenCalledWith('taste-1', { warnBeforeBuy: true })
  })

  it('reverts optimistic toggle when updateTaste rejects', async () => {
    mockedGetTaste.mockResolvedValueOnce(taste({ warnBeforeBuy: false }))
    mockedUpdateTaste.mockRejectedValueOnce(new Error('network'))
    const r = await renderDetail()
    const sw = switches(r)[0]
    await act(async () => {
      await sw.props.onChange(true)
    })
    // Should revert to false
    expect(switches(r)[0].props.checked).toBe(false)
  })

  // Tamagui XStack passes props (including testID) to both the component node
  // and the host View node — filter to only the host string node to get exactly 1.
  function warnBanners(r: TestRenderer.ReactTestRenderer) {
    return r.root.findAll(
      (n) => n.props.testID === 'warn-banner' && typeof n.type === 'string',
    )
  }

  it('shows warn banner when warnBeforeBuy=true AND user.warningsEnabled=true', async () => {
    mockedGetTaste.mockResolvedValueOnce(taste({ warnBeforeBuy: true }))
    mockedUpdateTaste.mockResolvedValue(taste({ warnBeforeBuy: true }))
    const r = await renderDetail()
    expect(warnBanners(r)).toHaveLength(1)
  })

  it('hides warn banner when warnBeforeBuy=false', async () => {
    mockedGetTaste.mockResolvedValueOnce(taste({ warnBeforeBuy: false }))
    const r = await renderDetail()
    expect(warnBanners(r)).toHaveLength(0)
  })

  it('hides warn banner when user.warningsEnabled=false even if warnBeforeBuy=true', async () => {
    mockUser = { plan: 'free', warningsEnabled: false }
    mockedGetTaste.mockResolvedValueOnce(taste({ warnBeforeBuy: true }))
    mockedUpdateTaste.mockResolvedValue(taste({ warnBeforeBuy: true }))
    const r = await renderDetail()
    expect(warnBanners(r)).toHaveLength(0)
  })
})

describe('DetailView — +1 Again sheet', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockRouteId = 'taste-1'
    mockUser = { plan: 'free', warningsEnabled: true }
  })

  // ds Input mock renders React.createElement('Input', p) — same double-match
  // issue as tamagui. Filter to string-type host nodes only.
  function sheetInput(r: TestRenderer.ReactTestRenderer, tid: string) {
    return r.root.findAll(
      (n) => n.props.testID === tid && typeof n.type === 'string',
    )[0]
  }
  function sheetBtn(r: TestRenderer.ReactTestRenderer, tid: string) {
    return r.root.findAll(
      (n) => n.props.testID === tid && typeof n.type === 'string',
    )[0]
  }
  function buyAgainBtn(r: TestRenderer.ReactTestRenderer) {
    return r.root.findAll(
      (n) => n.props.testID === 'buy-again-btn' && typeof n.type === 'string',
    )[0]
  }

  it('opens sheet when +1 Again button is pressed', async () => {
    mockedGetTaste.mockResolvedValueOnce(taste())
    const r = await renderDetail()
    await act(async () => { buyAgainBtn(r).props.onPress() })
    expect(sheetInput(r, 'buy-price-input')).toBeTruthy()
  })

  it('prefills sheet from purchases[0] when available', async () => {
    mockedGetTaste.mockResolvedValueOnce(taste({
      purchases: [{ id: 'p1', tasteId: 'taste-1', price: '3.50', place: 'New Branch', createdAt: '2026-06-09T00:00:00.000Z' }],
    }))
    const r = await renderDetail()
    await act(async () => { buyAgainBtn(r).props.onPress() })
    expect(sheetInput(r, 'buy-price-input').props.value).toBe('3.50')
    expect(sheetInput(r, 'buy-place-input').props.value).toBe('New Branch')
  })

  it('prefills from taste fallback when purchases is empty', async () => {
    mockedGetTaste.mockResolvedValueOnce(taste({ price: '4.00', place: 'Corner Cafe', purchases: [] }))
    const r = await renderDetail()
    await act(async () => { buyAgainBtn(r).props.onPress() })
    expect(sheetInput(r, 'buy-price-input').props.value).toBe('4.00')
    expect(sheetInput(r, 'buy-place-input').props.value).toBe('Corner Cafe')
  })

  it('calls addPurchase with edited values on confirm', async () => {
    mockedGetTaste.mockResolvedValueOnce(taste({ purchases: [] }))
    mockedAddPurchase.mockResolvedValueOnce({ purchase: { id: 'p2', tasteId: 'taste-1', price: '5.00', place: 'Mall', createdAt: '' }, boughtCount: 3 })
    const r = await renderDetail()
    await act(async () => { buyAgainBtn(r).props.onPress() })
    await act(async () => { sheetInput(r, 'buy-price-input').props.onChangeText('5.00') })
    await act(async () => { sheetInput(r, 'buy-place-input').props.onChangeText('Mall') })
    await act(async () => {
      await sheetBtn(r, 'buy-confirm-btn').props.onPress()
    })
    expect(mockedAddPurchase).toHaveBeenCalledWith('taste-1', { price: '5.00', place: 'Mall' })
  })

  it('closes sheet after successful addPurchase', async () => {
    mockedGetTaste.mockResolvedValueOnce(taste({ boughtCount: 2, purchases: [] }))
    mockedAddPurchase.mockResolvedValueOnce({ purchase: { id: 'p2', tasteId: 'taste-1', price: null, place: null, createdAt: '' }, boughtCount: 3 })
    const r = await renderDetail()
    await act(async () => { buyAgainBtn(r).props.onPress() })
    await act(async () => {
      await sheetBtn(r, 'buy-confirm-btn').props.onPress()
    })
    // Sheet closed: confirm button no longer rendered
    expect(r.root.findAll((n) => n.props.testID === 'buy-confirm-btn' && typeof n.type === 'string')).toHaveLength(0)
  })

  it('prefills sheet with NEW price/place after a confirmed +1 (purchases prepend fix)', async () => {
    mockedGetTaste.mockResolvedValueOnce(taste({ purchases: [], price: '4.00', place: 'Old Place' }))
    mockedAddPurchase.mockResolvedValueOnce({
      purchase: { id: 'p3', tasteId: 'taste-1', price: '6.00', place: 'New Place', createdAt: '2026-06-10T00:00:00.000Z' },
      boughtCount: 3,
    })
    const r = await renderDetail()

    // Open, edit, confirm first purchase
    await act(async () => { buyAgainBtn(r).props.onPress() })
    await act(async () => { sheetInput(r, 'buy-price-input').props.onChangeText('6.00') })
    await act(async () => { sheetInput(r, 'buy-place-input').props.onChangeText('New Place') })
    await act(async () => { await sheetBtn(r, 'buy-confirm-btn').props.onPress() })

    // Re-open the sheet — it should prefill from the newly prepended purchase
    await act(async () => { buyAgainBtn(r).props.onPress() })
    expect(sheetInput(r, 'buy-price-input').props.value).toBe('6.00')
    expect(sheetInput(r, 'buy-place-input').props.value).toBe('New Place')
  })

  it('reverts optimistic boughtCount when addPurchase rejects', async () => {
    mockedGetTaste.mockResolvedValueOnce(taste({ boughtCount: 2, purchases: [] }))
    mockedAddPurchase.mockRejectedValueOnce(new Error('network'))
    const r = await renderDetail()
    await act(async () => { buyAgainBtn(r).props.onPress() })
    await act(async () => {
      await sheetBtn(r, 'buy-confirm-btn').props.onPress()
    })
    // boughtCount badge shows 'bought_n' with n=2 (t() mock returns 'key:n' form)
    const badge = r.root.findAll(
      (n) => (n.type as unknown) === 'Badge' && typeof n.props.children === 'string' && n.props.children === 'bought_n:2',
    )
    expect(badge.length).toBeGreaterThan(0)
  })
})

describe('DetailView — +1 Again sheet warn banner (spec §2.C)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  function sheetWarnBanners(r: TestRenderer.ReactTestRenderer) {
    return r.root.findAll(
      (n) => n.props.testID === 'buy-sheet-warn-banner' && typeof n.type === 'string',
    )
  }
  function buyAgainBtn(r: TestRenderer.ReactTestRenderer) {
    return r.root.findAll(
      (n) => n.props.testID === 'buy-again-btn' && typeof n.type === 'string',
    )[0]
  }

  it('shows warn banner in sheet when warnBeforeBuy=true AND warningsEnabled=true', async () => {
    mockUser = { plan: 'free', warningsEnabled: true }
    mockedGetTaste.mockResolvedValueOnce(taste({ warnBeforeBuy: true }))
    const r = await renderDetail()
    await act(async () => { buyAgainBtn(r).props.onPress() })
    expect(sheetWarnBanners(r)).toHaveLength(1)
  })

  it('hides warn banner in sheet when warnBeforeBuy=false', async () => {
    mockUser = { plan: 'free', warningsEnabled: true }
    mockedGetTaste.mockResolvedValueOnce(taste({ warnBeforeBuy: false }))
    const r = await renderDetail()
    await act(async () => { buyAgainBtn(r).props.onPress() })
    expect(sheetWarnBanners(r)).toHaveLength(0)
  })

  it('hides warn banner in sheet when warningsEnabled=false even if warnBeforeBuy=true', async () => {
    mockUser = { plan: 'free', warningsEnabled: false }
    mockedGetTaste.mockResolvedValueOnce(taste({ warnBeforeBuy: true }))
    mockedUpdateTaste.mockResolvedValue(taste({ warnBeforeBuy: true }))
    const r = await renderDetail()
    await act(async () => { buyAgainBtn(r).props.onPress() })
    expect(sheetWarnBanners(r)).toHaveLength(0)
  })

  it('hides warn banner in sheet when both warnBeforeBuy=false and warningsEnabled=false', async () => {
    mockUser = { plan: 'free', warningsEnabled: false }
    mockedGetTaste.mockResolvedValueOnce(taste({ warnBeforeBuy: false }))
    const r = await renderDetail()
    await act(async () => { buyAgainBtn(r).props.onPress() })
    expect(sheetWarnBanners(r)).toHaveLength(0)
  })

  it('shows banner in sheet after toggling warn ON (item.warnBeforeBuy must sync)', async () => {
    // Regression: toggleRemind updated remind state but not item.warnBeforeBuy, so
    // the sheet banner (which reads item.warnBeforeBuy) was missing after toggling on.
    mockUser = { plan: 'free', warningsEnabled: true }
    mockedGetTaste.mockResolvedValueOnce(taste({ warnBeforeBuy: false }))
    mockedUpdateTaste.mockResolvedValueOnce(taste({ warnBeforeBuy: true }))
    const r = await renderDetail()

    // Toggle warn ON
    const sw = r.root.findAll((n) => (n.type as unknown) === 'Switch')[0]
    await act(async () => { await sw.props.onChange(true) })

    // Open the +1 sheet — banner must now appear
    await act(async () => { buyAgainBtn(r).props.onPress() })
    expect(sheetWarnBanners(r)).toHaveLength(1)
  })

  it('hides banner in sheet after toggling warn OFF (item.warnBeforeBuy must sync)', async () => {
    // Regression: stale item.warnBeforeBuy=true could keep the sheet banner visible
    // even after the user toggled warn OFF.
    mockUser = { plan: 'free', warningsEnabled: true }
    mockedGetTaste.mockResolvedValueOnce(taste({ warnBeforeBuy: true }))
    mockedUpdateTaste.mockResolvedValueOnce(taste({ warnBeforeBuy: false }))
    const r = await renderDetail()

    // Toggle warn OFF
    const sw = r.root.findAll((n) => (n.type as unknown) === 'Switch')[0]
    await act(async () => { await sw.props.onChange(false) })

    // Open the +1 sheet — banner must be absent
    await act(async () => { buyAgainBtn(r).props.onPress() })
    expect(sheetWarnBanners(r)).toHaveLength(0)
  })
})

describe('DetailView — id-change resets repurchase state', () => {
  // Uses the DetailViewCacheSeed pattern: both tastes are in cache so the
  // id swap is synchronous (no network round-trip, no loading spinner).

  const tasteA = taste({ id: 'taste-1', name: 'Espresso', warnBeforeBuy: true, price: '4.00', place: 'Cafe A' })
  const tasteB = taste({ id: 'taste-2', name: 'Matcha',   warnBeforeBuy: false, price: '5.00', place: 'Cafe B' })

  beforeEach(() => {
    jest.clearAllMocks()
    mockRouteId = 'taste-1'
    mockUser = { plan: 'free', warningsEnabled: true }
    const { getCachedTaste } = jest.requireMock('@/app/(tabs)/_useTastes') as {
      getCachedTaste: jest.Mock
    }
    getCachedTaste.mockImplementation((id: string) => {
      if (id === 'taste-1') return tasteA
      if (id === 'taste-2') return tasteB
      return undefined
    })
  })

  it('clears sheet open/inputs/remind when id changes to taste B', async () => {
    // Render A with sheet open and inputs typed.
    const r = await renderDetail()

    // Open the buy sheet and type into both inputs.
    const buyBtn = r.root.findAll(
      (n) => n.props.testID === 'buy-again-btn' && typeof n.type === 'string',
    )[0]
    await act(async () => { buyBtn.props.onPress() })

    // Sheet is open — confirm-button present.
    expect(
      r.root.findAll((n) => n.props.testID === 'buy-confirm-btn' && typeof n.type === 'string'),
    ).toHaveLength(1)

    // Swap to taste B.
    mockRouteId = 'taste-2'
    await act(async () => { r.update(<DetailView />) })

    // Sheet must be closed — confirm button gone.
    expect(
      r.root.findAll((n) => n.props.testID === 'buy-confirm-btn' && typeof n.type === 'string'),
    ).toHaveLength(0)

    // remind must reflect taste B (warnBeforeBuy=false) — switch unchecked.
    const sw = r.root.findAll((n) => (n.type as unknown) === 'Switch')[0]
    expect(sw.props.checked).toBe(false)
  })

  it('does not mutate taste B state when toggleRemind for A rejects after id swap', async () => {
    // Render A, start a toggle that will reject, then swap to B before it resolves.
    let rejectToggle!: (e: Error) => void
    mockedUpdateTaste.mockReturnValue(
      new Promise<Taste>((_, reject) => { rejectToggle = reject }),
    )

    const r = await renderDetail()
    const sw = r.root.findAll((n) => (n.type as unknown) === 'Switch')[0]

    // Fire toggle for A — updateTaste stays pending.
    act(() => { sw.props.onChange(false) })

    // Swap to B while the toggle for A is still in-flight.
    mockRouteId = 'taste-2'
    await act(async () => { r.update(<DetailView />) })

    // Reject the toggle for A now.
    await act(async () => { rejectToggle(new Error('network')) })

    // Taste B's Switch must still reflect B's warnBeforeBuy=false — not clobbered
    // by A's revert which would set it back to true.
    const swB = r.root.findAll((n) => (n.type as unknown) === 'Switch')[0]
    expect(swB.props.checked).toBe(false)
  })
})
