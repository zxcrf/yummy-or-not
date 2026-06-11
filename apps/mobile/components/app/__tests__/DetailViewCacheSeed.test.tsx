import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { ActivityIndicator, Image } from 'react-native'
import { Image as ExpoImage } from 'expo-image'
import {
  getOriginalPhotoUrl,
  getTaste,
  updateTaste,
  type Taste,
} from '@yon/shared'

import DetailView from '../DetailView'

// The first test in this file pays the cold import of Tamagui / expo-image /
// the RN preset; on slower CI runners that can exceed Jest's 5s default. Raise
// the ceiling so a cold start can't flake the suite (local runs finish in ~1s).
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

jest.mock('@/providers/I18nProvider', () => ({
  useI18n: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      if (!values) return key
      if (values.n != null) return `${key}:${values.n}`
      return key
    },
    formatMoney: (amount: number | string) => {
      const n =
        typeof amount === 'number'
          ? amount
          : Number.parseFloat(String(amount).replace(/[^0-9.]/g, ''))
      if (!Number.isFinite(n)) return ''
      return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`
    },
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

const mockedGetOriginalPhotoUrl = jest.mocked(getOriginalPhotoUrl)
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

async function flushPromises(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}

function findButtons(renderer: TestRenderer.ReactTestRenderer) {
  return renderer.root.findAll((node) => (node.type as unknown) === 'Button')
}

function findInput(renderer: TestRenderer.ReactTestRenderer, label: string) {
  return renderer.root.findAll((node) => (node.type as unknown) === 'Input')
    .find((node) => node.props.label === label)
}

function findHero(renderer: TestRenderer.ReactTestRenderer) {
  return renderer.root.findByType(ExpoImage)
}

function findTextContent(renderer: TestRenderer.ReactTestRenderer, text: string) {
  return renderer.root.findAll(
    (node) =>
      typeof node.type === 'string' &&
      node.children.includes(text),
  )
}

beforeEach(() => {
  jest.clearAllMocks()
  mockRouteId = 'taste-1'
  mockPlan = 'free'
  mockGetCachedTaste.mockReset()
  mockInvalidateTastes.mockClear()
  // clearAllMocks keeps implementations; reset @yon/shared fns so a deferred
  // promise set by one test cannot leak into the next.
  mockedGetTaste.mockReset()
  mockedUpdateTaste.mockReset()
  mockedGetOriginalPhotoUrl.mockReset()
})

describe('DetailView cache seeding', () => {
  it('uses the shared list cache to render immediately without getTaste and reuses the :thumb disk key', async () => {
    const cached = taste({
      imageThumb: 'https://cdn.example.com/taste-1-thumb.webp?sig=1',
      imageKey: 'tastes/u1/taste-1',
    })
    mockGetCachedTaste.mockImplementation((id) => (id === 'taste-1' ? cached : undefined))

    const renderer = await renderDetail()
    await flushPromises()

    // Why this matters: opening from a warm list must not spend a network round-trip on getTaste.
    expect(mockedGetTaste).not.toHaveBeenCalled()
    // Why this matters: cache-hit opens should paint content, not a loading spinner.
    expect(renderer.root.findAllByType(ActivityIndicator)).toHaveLength(0)
    // Why this matters: hero must reuse the already-cached thumbnail asset instead of a new display fetch.
    expect(findHero(renderer).props.source).toEqual({
      uri: 'https://cdn.example.com/taste-1-thumb.webp?sig=1',
      cacheKey: 'tastes/u1/taste-1:thumb',
    })
  })

  it('falls back to getTaste on cache miss while keeping the loading state instead of flashing the empty state', async () => {
    let resolveTaste!: (value: Taste) => void
    mockGetCachedTaste.mockReturnValue(undefined)
    mockedGetTaste.mockReturnValueOnce(
      new Promise<Taste>((resolve) => {
        resolveTaste = resolve
      }),
    )

    const renderer = await renderDetail()

    // Why this matters: deep-links still need the old network fetch path when no shared cache exists.
    expect(mockedGetTaste).toHaveBeenCalledWith('taste-1')
    // Why this matters: cold misses should show loading, not a misleading "nothing here" empty state.
    expect(renderer.root.findAllByType(ActivityIndicator)).toHaveLength(1)
    expect(findTextContent(renderer, 'nothing_here')).toHaveLength(0)

    await act(async () => {
      resolveTaste(taste({ name: 'Resolved Taste' }))
      await Promise.resolve()
    })

    // Why this matters: after the fallback fetch resolves, the requested taste must render normally.
    expect(findTextContent(renderer, 'Resolved Taste')).not.toHaveLength(0)
  })

  it('re-seeds from cache when the route id changes on the same mounted instance', async () => {
    const first = taste({ id: 'taste-1', name: 'First Taste' })
    const second = taste({ id: 'taste-2', name: 'Second Taste' })
    mockGetCachedTaste.mockImplementation((id) => {
      if (id === 'taste-1') return first
      if (id === 'taste-2') return second
      return undefined
    })

    const renderer = await renderDetail()
    expect(findTextContent(renderer, 'First Taste')).not.toHaveLength(0)

    mockedGetTaste.mockClear()
    mockRouteId = 'taste-2'
    await act(async () => {
      renderer.update(<DetailView />)
    })

    // Why this matters: navigating between detail ids must swap to the new cached item, not leave stale content behind.
    expect(findTextContent(renderer, 'Second Taste')).not.toHaveLength(0)
    expect(findTextContent(renderer, 'First Taste')).toHaveLength(0)
    // Why this matters: the swap is driven by the synchronous render-phase re-seed
    // from cache (not the late passive effect), so a hit→hit id change must neither
    // refetch from the server nor flash a loading spinner.
    expect(mockedGetTaste).not.toHaveBeenCalled()
    expect(renderer.root.findAllByType(ActivityIndicator)).toHaveLength(0)
  })

  it('cancels in-progress edit when the route id changes, preventing a cross-taste save', async () => {
    // Editing taste A then a same-instance id swap to taste B must drop A's edit
    // form — otherwise saveEdit would PATCH B with A's stale fields.
    const a = taste({ id: 'taste-1', name: 'Alpha' })
    const b = taste({ id: 'taste-2', name: 'Bravo' })
    mockGetCachedTaste.mockImplementation((id) =>
      id === 'taste-1' ? a : id === 'taste-2' ? b : undefined,
    )

    const renderer = await renderDetail()
    const editBtn = findButtons(renderer).find((node) => node.children.includes('edit'))
    await act(async () => {
      editBtn?.props.onPress()
    })

    mockRouteId = 'taste-2'
    await act(async () => {
      renderer.update(<DetailView />)
    })

    // Why this matters: after the id swap we must be in read mode for B (its name
    // rendered as text), not still holding A's edit form. If edit state survived,
    // B's name would sit inside an Input value and not appear as text content.
    expect(findTextContent(renderer, 'Bravo')).not.toHaveLength(0)
    expect(findTextContent(renderer, 'Alpha')).toHaveLength(0)
  })

  it('drops an in-flight save when the route id changed before it resolved (no cross-taste write)', async () => {
    const a = taste({ id: 'taste-1', name: 'Alpha' })
    const b = taste({ id: 'taste-2', name: 'Bravo' })
    mockGetCachedTaste.mockImplementation((id) =>
      id === 'taste-1' ? a : id === 'taste-2' ? b : undefined,
    )
    let resolveUpdate!: (t: Taste) => void
    mockedUpdateTaste.mockReturnValue(
      new Promise<Taste>((resolve) => {
        resolveUpdate = resolve
      }),
    )

    const renderer = await renderDetail()
    const editBtn = findButtons(renderer).find((node) => node.children.includes('edit'))
    await act(async () => {
      editBtn?.props.onPress()
    })
    const saveBtn = findButtons(renderer).find((node) =>
      node.children.includes('save_taste_web'),
    )
    // Fire save but do NOT await — updateTaste stays pending on purpose.
    await act(async () => {
      saveBtn?.props.onPress()
    })

    // Route swaps to B while the save for A is still pending.
    mockRouteId = 'taste-2'
    await act(async () => {
      renderer.update(<DetailView />)
    })
    await act(async () => {
      resolveUpdate({ ...a, name: 'Alpha EDITED' })
    })

    // Why this matters: A's updated record must never paint onto B's screen.
    expect(findTextContent(renderer, 'Bravo')).not.toHaveLength(0)
    expect(findTextContent(renderer, 'Alpha EDITED')).toHaveLength(0)
    // The server write to A did happen, so the shared list still refreshes.
    expect(mockInvalidateTastes).toHaveBeenCalled()
  })

  it('drops an in-flight original-photo fetch when the route id changed before it resolved', async () => {
    mockPlan = 'pro'
    const a = taste({ id: 'taste-1', name: 'Alpha' })
    const b = taste({ id: 'taste-2', name: 'Bravo' })
    mockGetCachedTaste.mockImplementation((id) =>
      id === 'taste-1' ? a : id === 'taste-2' ? b : undefined,
    )
    let resolveOriginal!: (v: { url: string; expiresIn: number }) => void
    mockedGetOriginalPhotoUrl.mockReturnValue(
      new Promise((resolve) => {
        resolveOriginal = resolve
      }),
    )

    const renderer = await renderDetail()
    const viewBtn = findButtons(renderer).find((node) =>
      node.children.includes('view_original'),
    )
    await act(async () => {
      viewBtn?.props.onPress()
    })

    mockRouteId = 'taste-2'
    await act(async () => {
      renderer.update(<DetailView />)
    })
    await act(async () => {
      resolveOriginal({ url: 'https://cdn.example.com/A-original.jpg', expiresIn: 3600 })
    })

    // Why this matters: A's original photo must not pop open in a modal over B.
    expect(
      renderer.root
        .findAllByType(Image)
        .find((node) => node.props.source?.uri === 'https://cdn.example.com/A-original.jpg'),
    ).toBeFalsy()
  })

  it('adopts a late cache fill (render miss, cache ready by effect) instead of stranding the spinner', async () => {
    // Render/init see a miss (loading=true); the shared list cache then fills
    // before the passive effect runs. The effect must adopt the cached taste,
    // NOT early-return — otherwise the screen stays on the spinner forever
    // (DetailView does not subscribe to the cache).
    const cached = taste({ id: 'taste-1', name: 'Late Cache Taste' })
    mockGetCachedTaste
      .mockReturnValueOnce(undefined) // useState item initializer (render miss)
      .mockReturnValueOnce(undefined) // useState loading initializer (render miss)
      .mockReturnValue(cached) //        effect sees the freshly-filled cache

    const renderer = await renderDetail()

    // Why this matters: a late cache hit must resolve the screen without a paid
    // network refetch and without leaving the loading spinner up.
    expect(mockedGetTaste).not.toHaveBeenCalled()
    expect(renderer.root.findAllByType(ActivityIndicator)).toHaveLength(0)
    expect(findTextContent(renderer, 'Late Cache Taste')).not.toHaveLength(0)
  })

  it('requests the original photo only after the pro user taps view original, then opens the modal', async () => {
    mockPlan = 'pro'
    mockGetCachedTaste.mockReturnValue(taste())
    mockedGetOriginalPhotoUrl.mockResolvedValueOnce({
      url: 'https://cdn.example.com/original-signed.jpg',
      expiresIn: 3600,
    })

    const renderer = await renderDetail()

    // Why this matters: opening the detail page should not trigger a paid original-photo fetch by itself.
    expect(mockedGetOriginalPhotoUrl).not.toHaveBeenCalled()

    const button = findButtons(renderer).find((node) => node.children.includes('view_original'))
    await act(async () => {
      await button?.props.onPress()
    })

    // Why this matters: the original should be fetched only on demand from the explicit button tap.
    expect(mockedGetOriginalPhotoUrl).toHaveBeenCalledWith('taste-1')
    // Why this matters: once fetched, the fullscreen modal must display the signed original URL.
    expect(
      renderer.root.findAllByType(Image).find((node) => node.props.source?.uri === 'https://cdn.example.com/original-signed.jpg'),
    ).toBeTruthy()
  })

  it('still invalidates the shared list after saving an edit', async () => {
    mockGetCachedTaste.mockReturnValue(taste())
    mockedUpdateTaste.mockResolvedValueOnce(taste({ name: 'Flat White' }))

    const renderer = await renderDetail()
    const editButton = findButtons(renderer).find((node) => node.children.includes('edit'))
    await act(async () => {
      editButton?.props.onPress()
    })

    const nameInput = findInput(renderer, 'f_what')
    await act(async () => {
      nameInput?.props.onChangeText('Flat White')
    })

    const saveButton = findButtons(renderer).find((node) => node.children.includes('save_taste_web'))
    await act(async () => {
      await saveButton?.props.onPress()
    })

    // Why this matters: detail edits must keep the shared list freshness contract and notify other screens.
    expect(mockInvalidateTastes).toHaveBeenCalledTimes(1)
  })

  it('omits cacheKey when imageKey is missing but still renders imageThumb or image', async () => {
    mockGetCachedTaste.mockReturnValue(
      taste({
        imageThumb: 'https://cdn.example.com/thumb-no-key.webp',
        imageKey: '',
      }),
    )

    const renderer = await renderDetail()

    // Why this matters: legacy rows without imageKey still need a hero image without inventing a fake disk key.
    expect(findHero(renderer).props.source).toEqual({
      uri: 'https://cdn.example.com/thumb-no-key.webp',
    })
  })
})
