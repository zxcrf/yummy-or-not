/* ============================================================
   Regression tests — FamilyFeedView (S3c family feed screen).

   Pins:
   - On mount the screen fetches GET /api/feed/family via getFamilyFeed
     and renders one row per returned card (name + verdict stamp).
   - An empty result renders the empty state (no crash, no rows).
   - A rejected fetch renders the error state + retry affordance, NOT the
     empty state — so users are never misled into "no shared tastes" when
     the call actually failed (401 / 500 / network).
   ============================================================ */

import TestRenderer, { act } from 'react-test-renderer'

jest.mock('expo-image', () => ({ Image: () => null }))

const mockGetFamilyFeed = jest.fn()

jest.mock('@yon/shared', () => ({
  getFamilyFeed: (...args: unknown[]) => mockGetFamilyFeed(...args),
}))

jest.mock('@/components/ds', () => {
  const React = require('react')
  const { View } = require('react-native')
  return {
    VerdictStamp: ({ verdict }: { verdict: string }) =>
      React.createElement(View, { testID: `verdict-${verdict}` }),
  }
})

jest.mock('@/providers/I18nProvider', () => ({
  useI18n: () => ({ t: (k: string) => k }),
}))

import FamilyFeedView from '../FamilyFeedView'

const CARD = {
  id: 'c1',
  name: 'Mapo Tofu',
  verdict: 'yum',
  image: '',
  imageThumb: '',
  imageDisplay: '',
  gridCell: 'wx4g0',
}

const mountedRenderers: TestRenderer.ReactTestRenderer[] = []

async function render(): Promise<TestRenderer.ReactTestRenderer> {
  let renderer!: TestRenderer.ReactTestRenderer
  await act(async () => {
    renderer = TestRenderer.create(<FamilyFeedView />)
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

describe('FamilyFeedView', () => {
  it('fetches /api/feed/family on mount and renders a row per card', async () => {
    mockGetFamilyFeed.mockResolvedValueOnce([CARD])
    const renderer = await render()

    expect(mockGetFamilyFeed).toHaveBeenCalledTimes(1)
    expect(renderer.root.findByProps({ testID: 'family-card-c1' })).toBeTruthy()
    // Verdict stamp for the card's verdict is rendered.
    expect(renderer.root.findByProps({ testID: 'verdict-yum' })).toBeTruthy()
  })

  it('renders the empty state when the feed is empty (successful [] response)', async () => {
    mockGetFamilyFeed.mockResolvedValueOnce([])
    const renderer = await render()

    expect(mockGetFamilyFeed).toHaveBeenCalledTimes(1)
    expect(renderer.root.findByProps({ testID: 'family-feed-empty' })).toBeTruthy()
    expect(renderer.root.findAllByProps({ testID: 'family-card-c1' })).toHaveLength(0)
    // Must NOT show the error state for a successful empty response.
    expect(renderer.root.findAllByProps({ testID: 'family-feed-error' })).toHaveLength(0)
  })

  it('rejected fetch renders error state + retry, NOT the empty state', async () => {
    // Simulates 401 / 500 / network failure — apiFetch rejects with an Error.
    mockGetFamilyFeed.mockRejectedValueOnce(new Error('http_401'))
    const renderer = await render()

    expect(mockGetFamilyFeed).toHaveBeenCalledTimes(1)
    // Error UI is shown.
    expect(renderer.root.findByProps({ testID: 'family-feed-error' })).toBeTruthy()
    // Retry affordance is present.
    expect(renderer.root.findByProps({ testID: 'family-feed-retry' })).toBeTruthy()
    // The empty-state copy must NOT appear — it would mislead the user into
    // thinking there are no shared tastes when the call actually failed.
    expect(renderer.root.findAllByProps({ testID: 'family-feed-empty' })).toHaveLength(0)
    // No card rows either.
    expect(renderer.root.findAllByProps({ testID: 'family-card-c1' })).toHaveLength(0)
  })

  it('retry button re-invokes getFamilyFeed and shows cards on success', async () => {
    // First call fails, second succeeds.
    mockGetFamilyFeed
      .mockRejectedValueOnce(new Error('http_500'))
      .mockResolvedValueOnce([CARD])

    const renderer = await render()

    // Error state visible after first failed load.
    expect(renderer.root.findByProps({ testID: 'family-feed-error' })).toBeTruthy()

    // Press retry.
    await act(async () => {
      renderer.root.findByProps({ testID: 'family-feed-retry' }).props.onPress()
    })

    expect(mockGetFamilyFeed).toHaveBeenCalledTimes(2)
    // Cards now visible; error state gone.
    expect(renderer.root.findByProps({ testID: 'family-card-c1' })).toBeTruthy()
    expect(renderer.root.findAllByProps({ testID: 'family-feed-error' })).toHaveLength(0)
  })
})
