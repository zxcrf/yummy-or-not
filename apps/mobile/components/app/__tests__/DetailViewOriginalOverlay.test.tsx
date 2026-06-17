/* ============================================================
   Regression test — issue #149: the "view original" control must live
   as a floating pill OVERLAY in the bottom-right of the top hero image
   preview, NOT as a full-width Button down in the content area.

   Pins:
   1. The control renders INSIDE the hero wrapper subtree
      (testID `detail-read-photo-wrapper`), as an absolutely-positioned
      overlay anchored to the bottom-right (position:absolute + numeric
      right/bottom).
   2. It is no longer the content-area DS `Button` (no `Button` host with
      `view_original` children survives).
   3. Behavior is unchanged: a pro user's tap fetches the original; a free
      user's tap shows the upgrade Alert and does NOT fetch.

   This file must FAIL against the pre-#149 code (button is a DS Button in
   the content area, has no overlay style, is not under the hero wrapper)
   and PASS once the control is moved into the hero as the pill overlay.
   ============================================================ */

import React from 'react'
import { Alert, StyleSheet } from 'react-native'
import TestRenderer, { act } from 'react-test-renderer'
import { getOriginalPhotoUrl, getTaste, type Taste } from '@yon/shared'

import DetailView from '../DetailView'

jest.setTimeout(20000)

jest.mock('@yon/shared', () => ({
  TAG_CHOICES: ['Coffee', 'Dessert'],
  deleteTaste: jest.fn(),
  getOriginalPhotoUrl: jest.fn(),
  getTaste: jest.fn(),
  updateTaste: jest.fn(),
  ProRequiredError: class ProRequiredError extends Error {
    constructor(msg = 'pro_required') {
      super(msg)
      this.name = 'ProRequiredError'
      Object.setPrototypeOf(this, ProRequiredError.prototype)
    }
  },
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

// t() returns the key verbatim (no values) so labels are stable, matching the
// sibling DetailView suites.
jest.mock('@/providers/I18nProvider', () => ({
  useI18n: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      if (!values) return key
      if (values.n != null) return `${key}:${values.n}`
      return key
    },
    formatMoney: (amount: number | string) => String(amount),
  }),
}))

let mockPlan: 'free' | 'pro' = 'free'
jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'u1', plan: mockPlan } }),
}))

const mockGetCachedTaste = jest.fn<Taste | undefined, [string]>()
const mockInvalidateTastes = jest.fn(async () => [])
jest.mock('@/app/(tabs)/_useTastes', () => ({
  getCachedTaste: (id: string) => mockGetCachedTaste(id),
  invalidateTastes: () => mockInvalidateTastes(),
}))

jest.mock('@/app/(tabs)/_useTags', () => ({
  useTags: () => ({ tags: [], loading: false }),
  invalidateTagsCache: jest.fn(),
}))

jest.mock('@/components/ds', () => {
  const React = require('react')
  const stub =
    (name: string) =>
    ({ children, ...props }: { children?: React.ReactNode; [k: string]: unknown }) =>
      React.createElement(name, props, children)

  return {
    ConfirmSheet: () => null,
    Badge: stub('Badge'),
    Button: stub('Button'),
    Card: stub('Card'),
    EditActionHeader: (props: Record<string, unknown>) =>
      React.createElement('EditActionHeader', props),
    Icon: (props: Record<string, unknown>) => React.createElement('Icon', props),
    IconButton: stub('IconButton'),
    Input: (props: Record<string, unknown>) => React.createElement('Input', props),
    Switch: (props: Record<string, unknown>) => React.createElement('Switch', props),
    Tag: stub('Tag'),
    Textarea: (props: Record<string, unknown>) => React.createElement('Textarea', props),
    VerdictPicker: (props: Record<string, unknown>) =>
      React.createElement('VerdictPicker', props),
    VerdictStamp: (props: Record<string, unknown>) =>
      React.createElement('VerdictStamp', props),
  }
})

const mockedGetOriginalPhotoUrl = jest.mocked(getOriginalPhotoUrl)
const mockedGetTaste = jest.mocked(getTaste)

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
    date: '2026-06-10',
    notes: 'Too bitter',
    image: 'https://example.com/original.jpg',
    imageThumb: 'https://cdn.example.com/thumb.webp',
    imageDisplay: 'https://cdn.example.com/display.webp',
    imageKey: 'tastes/u1/uuid',
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

/** The DS Button stub renders a 'Button' host — used to prove the control is no
    longer a content-area Button after the move. */
function findButtons(renderer: TestRenderer.ReactTestRenderer) {
  return renderer.root.findAll((n) => (n.type as unknown) === 'Button')
}

/** Locate the overlay control by its stable testID + an onPress handler (the
    pressable itself, not a forwarded host clone). */
function findOverlay(renderer: TestRenderer.ReactTestRenderer) {
  return renderer.root.findAll(
    (n) =>
      n.props?.testID === 'view-original-overlay' &&
      typeof n.props?.onPress === 'function',
  )
}

const mountedRenderers: TestRenderer.ReactTestRenderer[] = []
afterEach(() => {
  act(() => {
    mountedRenderers.forEach((r) => r.unmount())
  })
  mountedRenderers.length = 0
})

beforeEach(() => {
  jest.clearAllMocks()
  mockRouteId = 'taste-1'
  mockPlan = 'free'
  mockGetCachedTaste.mockReturnValue(taste())
})

describe('issue #149 — view-original is a hero overlay (pro user)', () => {
  beforeEach(() => {
    mockPlan = 'pro'
  })

  it('renders the control as a bottom-right overlay INSIDE the hero wrapper', async () => {
    const renderer = await renderDetail()
    mountedRenderers.push(renderer)

    // The hero wrapper must exist...
    const wrapper = renderer.root.findAll(
      (n) => n.props?.testID === 'detail-read-photo-wrapper',
    )[0]
    expect(wrapper).toBeTruthy()

    // ...and the overlay control must live inside its subtree.
    const inHero = wrapper.findAll(
      (n) =>
        n.props?.testID === 'view-original-overlay' &&
        typeof n.props?.onPress === 'function',
    )
    expect(inHero.length).toBeGreaterThan(0)

    // It must be an absolute overlay anchored bottom-right.
    const style = StyleSheet.flatten(inHero[0].props.style) as Record<string, unknown>
    expect(style.position).toBe('absolute')
    expect(typeof style.right).toBe('number')
    expect(typeof style.bottom).toBe('number')
  })

  it('is no longer the content-area full-width DS Button', async () => {
    const renderer = await renderDetail()
    mountedRenderers.push(renderer)

    const oldButton = findButtons(renderer).find((b) =>
      b.children.includes('view_original'),
    )
    expect(oldButton).toBeUndefined()
  })

  it('fetches the original on tap (behavior preserved)', async () => {
    mockedGetOriginalPhotoUrl.mockResolvedValueOnce({
      url: 'https://cdn.example.com/orig-signed.jpg',
      expiresIn: 3600,
    })
    const renderer = await renderDetail()
    mountedRenderers.push(renderer)

    const overlay = findOverlay(renderer)
    expect(overlay.length).toBeGreaterThan(0)
    await act(async () => {
      await overlay[0].props.onPress()
    })
    expect(mockedGetOriginalPhotoUrl).toHaveBeenCalledWith('taste-1')
  })

  it('disables the overlay while the original fetch is in flight (loading parity)', async () => {
    /* The old DS Button was disabled during originalLoading. The raw Pressable
       must preserve that — and surface it to a11y — so a double-tap can't fire a
       second paid fetch. Pin both the `disabled` prop and accessibilityState. */
    let resolveOriginal!: (v: { url: string; expiresIn: number }) => void
    mockedGetOriginalPhotoUrl.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveOriginal = resolve
      }),
    )
    const renderer = await renderDetail()
    mountedRenderers.push(renderer)

    // Not loading yet → enabled.
    expect(findOverlay(renderer)[0].props.disabled).toBe(false)

    await act(async () => {
      findOverlay(renderer)[0].props.onPress()
    })

    // In-flight → disabled, and the disabled state is exposed to a11y.
    const loading = findOverlay(renderer)[0]
    expect(loading.props.disabled).toBe(true)
    expect(loading.props.accessibilityState?.disabled).toBe(true)

    await act(async () => {
      resolveOriginal({ url: 'https://cdn.example.com/orig-signed.jpg', expiresIn: 3600 })
    })
  })
})

describe('issue #149 — view-original is a hero overlay (free user)', () => {
  beforeEach(() => {
    mockPlan = 'free'
  })

  it('shows the upgrade overlay and does NOT fetch on tap', async () => {
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined)
    const renderer = await renderDetail()
    mountedRenderers.push(renderer)

    // Overlay present and labelled as the upgrade CTA.
    const overlay = findOverlay(renderer)
    expect(overlay.length).toBeGreaterThan(0)
    expect(overlay[0].props.accessibilityLabel).toBe('view_original_pro')

    // It is still inside the hero wrapper, not the content area.
    const wrapper = renderer.root.findAll(
      (n) => n.props?.testID === 'detail-read-photo-wrapper',
    )[0]
    expect(
      wrapper.findAll((n) => n.props?.testID === 'view-original-overlay').length,
    ).toBeGreaterThan(0)

    await act(async () => {
      overlay[0].props.onPress()
    })
    expect(mockedGetOriginalPhotoUrl).not.toHaveBeenCalled()
    // Behavior parity: the exact upgrade-alert strings must be unchanged.
    expect(Alert.alert).toHaveBeenCalledWith('pro_plan', 'taste_limit_reached')
  })
})

describe('issue #149 — no overlay without a photo / never refetches on mount', () => {
  it('does not render the overlay when the taste has no image', async () => {
    mockPlan = 'pro'
    mockGetCachedTaste.mockReturnValue(
      taste({ image: '', imageThumb: '', imageDisplay: '', imageKey: '' }),
    )
    const renderer = await renderDetail()
    mountedRenderers.push(renderer)

    expect(findOverlay(renderer)).toHaveLength(0)
    expect(mockedGetTaste).not.toHaveBeenCalled()
  })
})
