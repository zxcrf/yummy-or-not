/* ============================================================
   Regression tests — image variant fields + disk-cache keys in
   RecallView + DetailView.

   Behavior under test:
   - RecallView thumbnail must use imageThumb (54 px slot), not imageDisplay
     or image. Legacy rows where only `image` is set fall back to image.
   - DetailView hero must use imageThumb (240 px slot) — reusing the SAME
     (uri, cacheKey) the list card already cached — not imageDisplay or image
     directly. Legacy fallback same: if imageThumb absent, use image.
   - Both thumbnail and hero render via expo-image (not RN Image) and derive a
     stable disk cacheKey from Taste.imageKey: `${imageKey}:thumb` for both the
     thumbnail and the hero (the hero reuses the card's cached thumb). When
     imageKey is empty the source carries NO cacheKey (URL becomes the key).
   - DetailView "view original": pro users see a button that calls
     getOriginalPhotoUrl; free users see a ghost CTA that shows an upgrade
     alert instead.
   ============================================================ */

import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { Alert, Image } from 'react-native'
import { Image as ExpoImage } from 'expo-image'
import { getOriginalPhotoUrl, getTaste, ProRequiredError, type Taste } from '@yon/shared'

// ── shared mocks ────────────────────────────────────────────────────────────

jest.mock('@yon/shared', () => ({
  TAG_CHOICES: ['Coffee'],
  deleteTaste: jest.fn(),
  getTaste: jest.fn(),
  updateTaste: jest.fn(),
  getOriginalPhotoUrl: jest.fn(),
  listTastes: jest.fn(),
  ProRequiredError: class ProRequiredError extends Error {
    constructor(msg = 'pro_required') {
      super(msg)
      this.name = 'ProRequiredError'
      Object.setPrototypeOf(this, ProRequiredError.prototype)
    }
  },
}))

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'taste-1' }),
  useRouter: () => ({
    back: jest.fn(),
    canGoBack: jest.fn(() => true),
    replace: jest.fn(),
    push: jest.fn(),
  }),
}))

jest.mock('@/providers/I18nProvider', () => ({
  useI18n: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      if (!values) return key
      if (values.n != null) return `${key}:${values.n}`
      if (values.q != null) return `${key}:${values.q}`
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
  const stub =
    (name: string) =>
    ({ children, ...props }: { children?: React.ReactNode; [k: string]: unknown }) =>
      React.createElement(name, props, children)
  return {
    Badge: stub('Badge'),
    Button: stub('Button'),
    Card: stub('Card'),
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

// AuthProvider — swap plan per test suite via the factory below.
let mockPlan: 'free' | 'pro' = 'free'
jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'u1', plan: mockPlan } }),
}))

// Shared taste hook — RecallView reads its list from here; feed items directly
// so these tests exercise rendering, not the SWR/AsyncStorage plumbing (which
// has its own suite). invalidateTastes is a no-op spy for DetailView writes.
let mockItems: Taste[] = []
jest.mock('@/app/(tabs)/_useTastes', () => ({
  useRefreshableTastes: () => ({
    items: mockItems,
    loading: false,
    refresh: jest.fn(async () => {}),
  }),
  invalidateTastes: jest.fn(async () => mockItems),
  // Hero tests exercise the cache-MISS path (DetailView falls back to getTaste),
  // so the shared list cache reports no hit here.
  getCachedTaste: jest.fn(() => undefined),
}))

jest.mock('@/app/(tabs)/_useTags', () => ({
  useTags: () => ({ tags: [], loading: false }),
  invalidateTagsCache: jest.fn(),
}))

// ── helpers ──────────────────────────────────────────────────────────────────

function taste(overrides: Partial<Taste> = {}): Taste {
  return {
    id: 'taste-1',
    name: 'Espresso',
    place: 'Corner Cafe',
    price: '$4.00',
    verdict: 'yum',
    tags: [],
    boughtCount: 1,
    warnBeforeBuy: false,
    purchases: [],
    date: '2026-06-10',
    notes: '',
    image: 'https://example.com/orig.jpg',
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
    renderer = TestRenderer.create(
      React.createElement(
        require('../DetailView').default,
      ),
    )
  })
  return renderer
}

async function renderRecall(
  items: Taste[],
): Promise<TestRenderer.ReactTestRenderer> {
  mockItems = items
  let renderer!: TestRenderer.ReactTestRenderer
  await act(async () => {
    renderer = TestRenderer.create(
      React.createElement(require('../RecallView').default),
    )
  })
  return renderer
}

/** RN Image hosts (used only by the fullscreen "view original" modal now). */
function findImages(renderer: TestRenderer.ReactTestRenderer) {
  return renderer.root.findAllByType(Image)
}

/** expo-image hosts (the thumbnail + hero slots render through these). */
function findExpoImages(renderer: TestRenderer.ReactTestRenderer) {
  return renderer.root.findAllByType(ExpoImage)
}

function findButtons(renderer: TestRenderer.ReactTestRenderer) {
  return renderer.root.findAll((n) => (n.type as unknown) === 'Button')
}

const mockedGetTaste = jest.mocked(getTaste)
const mockedGetOriginalPhotoUrl = jest.mocked(getOriginalPhotoUrl)

// ── RecallView thumbnail tests ───────────────────────────────────────────────

describe('RecallView thumbnail source', () => {
  beforeEach(() => jest.clearAllMocks())

  it('uses imageThumb for the 54 px thumbnail with a stable :thumb cacheKey', async () => {
    /* The row must pass imageThumb as the expo-image source so the small slot
       serves a lightweight variant — and a cacheKey derived from imageKey so
       the disk cache survives the per-request signed-URL rotation. */
    const item = taste({
      imageThumb: 'https://cdn.example.com/t/uuid/thumb.webp?sig=a',
      imageDisplay: 'https://cdn.example.com/t/uuid/display.webp',
      image: 'https://example.com/orig.jpg',
      imageKey: 'tastes/u1/uuid',
    })
    const renderer = await renderRecall([item])

    const images = findExpoImages(renderer)
    expect(images.length).toBeGreaterThan(0)

    const thumbImg = images[0]
    expect(thumbImg.props.source).toEqual({
      uri: 'https://cdn.example.com/t/uuid/thumb.webp?sig=a',
      cacheKey: 'tastes/u1/uuid:thumb',
    })
    expect(thumbImg.props.cachePolicy).toBe('disk')
    // Must NOT be the full original or display variant.
    expect(thumbImg.props.source.uri).not.toBe('https://example.com/orig.jpg')
    expect(thumbImg.props.source.uri).not.toBe(
      'https://cdn.example.com/t/uuid/display.webp',
    )
  })

  it('omits cacheKey when imageKey is empty (legacy URL becomes the key)', async () => {
    /* Old/legacy rows have no stable storage key. We must NOT invent one — the
       source carries only the uri so expo-image keys by URL. */
    const item = taste({
      imageThumb: 'https://cdn.example.com/t/uuid/thumb.webp',
      imageKey: '',
    })
    const renderer = await renderRecall([item])

    const thumbImg = findExpoImages(renderer)[0]
    expect(thumbImg.props.source).toEqual({
      uri: 'https://cdn.example.com/t/uuid/thumb.webp',
    })
    expect(thumbImg.props.source.cacheKey).toBeUndefined()
  })

  it('falls back to image when imageThumb is absent (legacy row)', async () => {
    /* Legacy rows stored before variants were introduced have only `image`.
       The row must still render rather than showing a blank slot. */
    const item = taste({
      imageThumb: undefined,
      imageDisplay: undefined,
      image: 'https://example.com/legacy.jpg',
      imageKey: '',
    })
    const renderer = await renderRecall([item])

    const images = findExpoImages(renderer)
    expect(images.length).toBeGreaterThan(0)
    expect(images[0].props.source).toEqual({ uri: 'https://example.com/legacy.jpg' })
  })
})

// ── DetailView hero image tests ──────────────────────────────────────────────

describe('DetailView hero image source', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockPlan = 'free'
  })

  it('uses imageThumb for the 240 px hero with a stable :thumb cacheKey', async () => {
    /* The hero reuses the SAME (uri, cacheKey) the list card already cached:
       imageThumb via expo-image with a `${imageKey}:thumb` disk cacheKey. That
       way opening detail paints from the on-disk thumb the card stored — no
       network fetch of the heavier :display variant. */
    mockedGetTaste.mockResolvedValueOnce(
      taste({
        imageDisplay: 'https://cdn.example.com/t/uuid/display.webp',
        imageThumb: 'https://cdn.example.com/t/uuid/thumb.webp?sig=a',
        image: 'https://example.com/orig.jpg',
        imageKey: 'tastes/u1/uuid',
      }),
    )
    const renderer = await renderDetail()

    const images = findExpoImages(renderer)
    expect(images.length).toBeGreaterThan(0)

    // The hero is the only expo-image in the tree (the modal uses RN Image).
    const heroImg = images[0]
    expect(heroImg.props.source).toEqual({
      uri: 'https://cdn.example.com/t/uuid/thumb.webp?sig=a',
      cacheKey: 'tastes/u1/uuid:thumb',
    })
    expect(heroImg.props.cachePolicy).toBe('disk')
    // Must NOT fetch the original or the heavier display variant.
    expect(heroImg.props.source.uri).not.toBe('https://example.com/orig.jpg')
    expect(heroImg.props.source.uri).not.toBe(
      'https://cdn.example.com/t/uuid/display.webp',
    )
  })

  it('omits the hero cacheKey when imageKey is empty (legacy row)', async () => {
    mockedGetTaste.mockResolvedValueOnce(
      taste({
        imageThumb: 'https://cdn.example.com/t/uuid/thumb.webp',
        imageKey: '',
      }),
    )
    const renderer = await renderDetail()

    const heroImg = findExpoImages(renderer)[0]
    expect(heroImg.props.source).toEqual({
      uri: 'https://cdn.example.com/t/uuid/thumb.webp',
    })
    expect(heroImg.props.source.cacheKey).toBeUndefined()
  })

  it('falls back to image when imageThumb is absent (legacy row)', async () => {
    mockedGetTaste.mockResolvedValueOnce(
      taste({ imageThumb: undefined, imageDisplay: undefined, imageKey: '' }),
    )
    const renderer = await renderDetail()

    const images = findExpoImages(renderer)
    expect(images.length).toBeGreaterThan(0)
    expect(images[0].props.source).toEqual({ uri: 'https://example.com/orig.jpg' })
  })
})

// ── DetailView "view original" — plan gating ─────────────────────────────────

describe('DetailView original — pro user', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockPlan = 'pro'
  })

  it('shows "view_original" button for a pro user', async () => {
    mockedGetTaste.mockResolvedValueOnce(taste())
    const renderer = await renderDetail()

    const btn = findButtons(renderer).find((b) =>
      b.children.includes('view_original'),
    )
    expect(btn).toBeTruthy()
  })

  it('calls getOriginalPhotoUrl when a pro user taps view original', async () => {
    mockedGetTaste.mockResolvedValueOnce(taste())
    mockedGetOriginalPhotoUrl.mockResolvedValueOnce({
      url: 'https://cdn.example.com/orig-signed.jpg',
      expiresIn: 3600,
    })
    const renderer = await renderDetail()

    const btn = findButtons(renderer).find((b) =>
      b.children.includes('view_original'),
    )
    await act(async () => {
      await btn?.props.onPress()
    })

    expect(mockedGetOriginalPhotoUrl).toHaveBeenCalledWith('taste-1')
  })

  it('renders the returned original URL in the fullscreen modal', async () => {
    mockedGetTaste.mockResolvedValueOnce(taste())
    const signedUrl = 'https://cdn.example.com/orig-signed.jpg'
    mockedGetOriginalPhotoUrl.mockResolvedValueOnce({ url: signedUrl, expiresIn: 3600 })
    const renderer = await renderDetail()

    const btn = findButtons(renderer).find((b) =>
      b.children.includes('view_original'),
    )
    await act(async () => {
      await btn?.props.onPress()
    })

    // After resolving, a fullscreen Image with the signed URL must appear.
    const images = findImages(renderer)
    const modal = images.find((img) => img.props.source?.uri === signedUrl)
    expect(modal).toBeTruthy()
  })
})

describe('DetailView original — free user', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockPlan = 'free'
  })

  it('shows upgrade CTA (view_original_pro) instead of the plain view_original button', async () => {
    /* Regression: free users must NOT see the pro-only "view_original" button.
       They must see a ghost button with "view_original_pro" label that triggers
       the upgrade alert, not a direct photo fetch. */
    mockedGetTaste.mockResolvedValueOnce(taste())
    const renderer = await renderDetail()

    const proBtn = findButtons(renderer).find((b) =>
      b.children.includes('view_original'),
    )
    expect(proBtn).toBeUndefined()

    const upgradeBtn = findButtons(renderer).find((b) =>
      b.children.includes('view_original_pro'),
    )
    expect(upgradeBtn).toBeTruthy()
  })

  it('does NOT call getOriginalPhotoUrl when a free user taps the CTA', async () => {
    mockedGetTaste.mockResolvedValueOnce(taste())
    jest.spyOn(Alert, 'alert').mockImplementationOnce(() => undefined)
    const renderer = await renderDetail()

    const upgradeBtn = findButtons(renderer).find((b) =>
      b.children.includes('view_original_pro'),
    )
    await act(async () => {
      upgradeBtn?.props.onPress()
    })

    expect(mockedGetOriginalPhotoUrl).not.toHaveBeenCalled()
    expect(Alert.alert).toHaveBeenCalled()
  })
})
