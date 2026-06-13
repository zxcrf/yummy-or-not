/* ============================================================
   Tests — S3a import landing (deep link import/<token> + "enter import code").

   The landing component (components/app/ImportLanding.tsx — NOT yet
   implemented, so these FAIL now and PASS once S3a lands) reads the `token`
   route param, fetches a preview via getSharePreview, renders a preview card,
   and on "save to my to-taste" calls importShare then routes to the Library
   todo tab.

   Pins:
   1. On mount it fetches the preview for the route token and RENDERS the
      preview (name/place/verdict from getSharePreview).
   2. Pressing "save to my to-taste" calls importShare(token) exactly once,
      then navigates to the todo tab.
   3. A 410 (revoked/expired/source-deleted) preview shows the "no longer
      available" state and the save button is not offered.
   ============================================================ */

import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'

import ImportLanding from '../ImportLanding'

// ── shared API client mock ────────────────────────────────────────────────────
const mockGetSharePreview = jest.fn()
const mockImportShare = jest.fn()

jest.mock('@yon/shared', () => ({
  getSharePreview: (...a: unknown[]) => mockGetSharePreview(...a),
  importShare: (...a: unknown[]) => mockImportShare(...a),
}))

// ── router: mutable token param + spy-able navigation ─────────────────────────
const routeParams: { token: string } = { token: 'tok-share-1' }
const mockReplace = jest.fn()
const mockPush = jest.fn()

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => routeParams,
  useRouter: () => ({
    back: jest.fn(),
    canGoBack: jest.fn(() => true),
    replace: mockReplace,
    push: mockPush,
  }),
}))

jest.mock('@/providers/I18nProvider', () => ({
  useI18n: () => ({
    t: (key: string) => key,
    formatMoney: (n: number | string) => `$${n}`,
  }),
}))

jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({ user: { plan: 'free' } }),
}))

jest.mock('@/components/ds', () => {
  const React = require('react')
  const mk = (name: string) =>
    ({ children, ...props }: { children?: React.ReactNode }) =>
      React.createElement(name, props, children)
  return {
    Badge: mk('Badge'),
    Button: mk('Button'),
    Card: mk('Card'),
    Icon: mk('Icon'),
    IconButton: mk('IconButton'),
    Input: mk('Input'),
    Tag: mk('Tag'),
    VerdictStamp: mk('VerdictStamp'),
  }
})

// ShareCard / preview image stub if the landing reuses it.
jest.mock('@/components/app/ShareCard', () => {
  const React = require('react')
  const { forwardRef } = React
  const ShareCard = forwardRef((_p: unknown, ref: React.Ref<unknown>) =>
    React.createElement('View', { ref }))
  ShareCard.displayName = 'ShareCard'
  return { ShareCard }
})

// ── helpers ───────────────────────────────────────────────────────────────────

function preview(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Brown Sugar Boba',
    place: 'Tiger Sugar',
    price: '5.80',
    verdict: 'yum',
    tags: ['Boba'],
    notes: 'great',
    photoUrl: 'https://r2.example.com/x?X-Amz-Signature=short',
    ...overrides,
  }
}

async function renderLanding(): Promise<TestRenderer.ReactTestRenderer> {
  let r!: TestRenderer.ReactTestRenderer
  await act(async () => {
    r = TestRenderer.create(<ImportLanding />)
  })
  // flush the getSharePreview effect
  await act(async () => {
    await Promise.resolve()
  })
  return r
}

function findByTestID(r: TestRenderer.ReactTestRenderer, id: string) {
  return r.root.findAll((n) => n.props?.testID === id)[0]
}

// recursively collect all string children to assert rendered preview text.
function allText(r: TestRenderer.ReactTestRenderer): string {
  const out: string[] = []
  const walk = (node: unknown) => {
    if (typeof node === 'string') { out.push(node); return }
    if (Array.isArray(node)) { node.forEach(walk); return }
    if (node && typeof node === 'object' && 'children' in (node as Record<string, unknown>)) {
      walk((node as { children: unknown }).children)
    }
  }
  walk(r.toJSON())
  return out.join(' ')
}

beforeEach(() => {
  jest.clearAllMocks()
  routeParams.token = 'tok-share-1'
})

// ── tests ───────────────────────────────────────────────────────────────────

describe('ImportLanding (S3a)', () => {
  it('fetches the preview for the route token and renders it', async () => {
    mockGetSharePreview.mockResolvedValueOnce(preview())
    const r = await renderLanding()

    expect(mockGetSharePreview).toHaveBeenCalledWith('tok-share-1')
    // The preview content is rendered.
    expect(allText(r)).toContain('Brown Sugar Boba')
  })

  it('"save to my to-taste" calls importShare(token) once, then navigates to the todo tab', async () => {
    mockGetSharePreview.mockResolvedValueOnce(preview())
    mockImportShare.mockResolvedValueOnce({ id: 'copy-1', status: 'todo', verdict: null })
    const r = await renderLanding()

    const saveBtn = findByTestID(r, 'import-save-btn')
    expect(saveBtn).toBeTruthy()

    await act(async () => {
      saveBtn.props.onPress()
      await Promise.resolve()
    })

    expect(mockImportShare).toHaveBeenCalledTimes(1)
    expect(mockImportShare).toHaveBeenCalledWith('tok-share-1')

    // Routed to the Library todo tab after a successful import.
    const navTargets = [
      ...mockReplace.mock.calls.map((c) => String(c[0])),
      ...mockPush.mock.calls.map((c) => String(c[0])),
    ].join(' ')
    expect(navTargets).toMatch(/todo/)
  })

  it('a revoked/expired share (410) shows the unavailable state and offers no save button', async () => {
    mockGetSharePreview.mockRejectedValueOnce(new Error('share_gone'))
    const r = await renderLanding()

    // No save button when the share is gone.
    expect(findByTestID(r, 'import-save-btn')).toBeFalsy()
    // The unavailable state surfaces the error key (the component localizes it).
    expect(allText(r)).toMatch(/share_gone|share_unavailable|gone/)
    expect(mockImportShare).not.toHaveBeenCalled()
  })
})
