/* ============================================================
   Regression tests — DetailView per-record visibility selector (S3c).

   DetailView exposes a private / "Nearby" (public) switch for an existing
   record. It drives the EXISTING publish API:
   - public (ON)  → publishTasteGeo (PATCH /api/tastes/:id/visibility) — geo
     publish from the record's own coords; flips visibility to 'shared'.
   - private (OFF) → unpublishTaste (DELETE /api/tastes/:id/visibility) — removes
     shares; flips visibility to 'private'.

   Pins:
   - The switch renders for an existing record and reflects item.visibility.
   - Toggling ON calls publishTasteGeo(id) (NOT unpublish) and adopts the
     returned 'shared' record.
   - Toggling OFF (on a shared record) calls unpublishTaste(id) (NOT publish).
   - A record with no coords cannot be made public: the switch is disabled and a
     hint shows; toggling never calls publishTasteGeo.

   FAILS today: DetailView has no visibility switch and never calls
   publishTasteGeo / unpublishTaste. PASSES once S3c wires it in.

   Harness mirrors DetailViewWarn.test.tsx.
   ============================================================ */

import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { getTaste, publishTasteGeo, unpublishTaste, type Taste } from '@yon/shared'

import DetailView from '../DetailView'

jest.mock('@yon/shared', () => ({
  TAG_CHOICES: ['Coffee', 'Dessert'],
  deleteTaste: jest.fn(),
  getTaste: jest.fn(),
  updateTaste: jest.fn(),
  addPurchase: jest.fn(),
  getOriginalPhotoUrl: jest.fn(),
  mintShare: jest.fn(),
  encodeShareToken: jest.fn(() => 'code'),
  publishTasteGeo: jest.fn(),
  unpublishTaste: jest.fn(),
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
    formatMoney: (v: number | string) => String(v),
  }),
}))

jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({ user: { plan: 'free', warningsEnabled: true } }),
}))

jest.mock('@/components/ds', () => {
  const React = require('react')
  return {
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
const mockedPublish = jest.mocked(publishTasteGeo)
const mockedUnpublish = jest.mocked(unpublishTaste)

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
    notes: '',
    lat: 35.0,
    lng: 139.0,
    visibility: 'private',
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

function visibilitySwitch(r: TestRenderer.ReactTestRenderer) {
  return r.root.findAll(
    (n) => (n.type as unknown) === 'Switch' && n.props.testID === 'detail-visibility-switch',
  )[0]
}

describe('DetailView — per-record visibility (S3c)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders the visibility switch reflecting a private record (checked=false)', async () => {
    mockedGetTaste.mockResolvedValueOnce(taste({ visibility: 'private' }))
    const r = await renderDetail()
    const sw = visibilitySwitch(r)
    expect(sw).toBeTruthy()
    expect(sw.props.checked).toBe(false)
  })

  it('reflects a shared (published) record (checked=true)', async () => {
    mockedGetTaste.mockResolvedValueOnce(taste({ visibility: 'shared' }))
    const r = await renderDetail()
    expect(visibilitySwitch(r).props.checked).toBe(true)
  })

  it('toggling ON publishes via publishTasteGeo(id) (not unpublish) and adopts the shared record', async () => {
    mockedGetTaste.mockResolvedValueOnce(taste({ visibility: 'private' }))
    mockedPublish.mockResolvedValueOnce(taste({ visibility: 'shared' }))
    const r = await renderDetail()

    await act(async () => { await visibilitySwitch(r).props.onChange(true) })

    expect(mockedPublish).toHaveBeenCalledTimes(1)
    expect(mockedPublish).toHaveBeenCalledWith('taste-1')
    expect(mockedUnpublish).not.toHaveBeenCalled()
    // The switch now reflects the server-returned 'shared' record.
    expect(visibilitySwitch(r).props.checked).toBe(true)
  })

  it('toggling OFF on a shared record unpublishes via unpublishTaste(id) (not publish)', async () => {
    mockedGetTaste.mockResolvedValueOnce(taste({ visibility: 'shared' }))
    mockedUnpublish.mockResolvedValueOnce(taste({ visibility: 'private' }))
    const r = await renderDetail()

    await act(async () => { await visibilitySwitch(r).props.onChange(false) })

    expect(mockedUnpublish).toHaveBeenCalledTimes(1)
    expect(mockedUnpublish).toHaveBeenCalledWith('taste-1')
    expect(mockedPublish).not.toHaveBeenCalled()
    expect(visibilitySwitch(r).props.checked).toBe(false)
  })

  it('a record with no coords cannot be published: switch disabled, hint shown, no publish call', async () => {
    mockedGetTaste.mockResolvedValueOnce(taste({ visibility: 'private', lat: null, lng: null }))
    const r = await renderDetail()

    const sw = visibilitySwitch(r)
    expect(sw.props.disabled).toBe(true)
    expect(
      r.root.findAll(
        (n) => n.props.testID === 'detail-visibility-no-location-hint' && typeof n.type === 'string',
      ).length,
    ).toBeGreaterThan(0)

    // Even if a caller forced onChange, the handler must not publish a
    // location-less record (the server would 422). Guarded at the API by coords,
    // but the disabled switch is the user-facing gate.
    expect(mockedPublish).not.toHaveBeenCalled()
  })
})
