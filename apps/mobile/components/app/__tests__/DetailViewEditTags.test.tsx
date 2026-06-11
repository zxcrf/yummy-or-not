/* ============================================================
   Regression tests — DetailView edit-mode tag chips read from tag library.

   Gap 2 pin: a tag that is in the user's tag library but NOT in the
   built-in TAG_CHOICES must appear in the edit-mode chip list and be
   toggleable. Previously the chips were hard-coded to TAG_CHOICES only,
   so user-created tags could never be applied when editing a taste.
   ============================================================ */

import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { getTaste, type Taste } from '@yon/shared'

import DetailView from '../DetailView'

// The built-in choices. 'CustomTag' is intentionally absent here —
// it lives only in the user's tag library. That is the gap this test pins.
const BUILT_IN_TAGS = ['Coffee', 'Dessert']

jest.mock('@yon/shared', () => ({
  TAG_CHOICES: ['Coffee', 'Dessert'],
  deleteTaste: jest.fn(),
  getTaste: jest.fn(),
  updateTaste: jest.fn().mockResolvedValue(undefined),
  addPurchase: jest.fn(),
  getOriginalPhotoUrl: jest.fn(),
  ProRequiredError: class ProRequiredError extends Error {},
}))

jest.mock('@/app/(tabs)/_useTastes', () => ({
  invalidateTastes: jest.fn(async () => []),
  getCachedTaste: jest.fn(() => undefined),
}))

// Inject 'CustomTag' as a user library tag — not in BUILT_IN_TAGS
jest.mock('@/app/(tabs)/_useTags', () => ({
  useTags: () => ({
    tags: [
      { id: 'tag-10', name: 'Coffee' },
      { id: 'tag-11', name: 'CustomTag' },
    ],
    loading: false,
  }),
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
    formatMoney: (amount: number | string) => {
      const n = typeof amount === 'number'
        ? amount
        : Number.parseFloat(String(amount).replace(/[^0-9.]/g, ''))
      if (!Number.isFinite(n)) return ''
      return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`
    },
  }),
}))

jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({
    user: { avatar: '', displayName: 'Test User', email: '', phone: '', plan: 'free', warningsEnabled: false, locationEnabled: false },
    patchUser: jest.fn(),
  }),
}))

jest.mock('@/components/ds', () => {
  const React = require('react')
  return {
    Badge: ({ children, ...props }: { children?: React.ReactNode }) =>
      React.createElement('Badge', props, children),
    Button: ({ children, ...props }: { children?: React.ReactNode }) =>
      React.createElement('Button', props, children),
    Card: ({ children, ...props }: { children?: React.ReactNode }) =>
      React.createElement('Card', props, children),
    Icon: (props: Record<string, unknown>) => React.createElement('Icon', props),
    IconButton: ({ children, ...props }: { children?: React.ReactNode }) =>
      React.createElement('IconButton', props, children),
    Input: (props: Record<string, unknown>) => React.createElement('Input', props),
    Switch: (props: Record<string, unknown>) => React.createElement('Switch', props),
    Tag: ({ children, ...props }: { children?: React.ReactNode }) =>
      React.createElement('Tag', props, children),
    Textarea: (props: Record<string, unknown>) => React.createElement('Textarea', props),
    VerdictPicker: (props: Record<string, unknown>) =>
      React.createElement('VerdictPicker', props),
    VerdictStamp: (props: Record<string, unknown>) =>
      React.createElement('VerdictStamp', props),
  }
})

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

async function renderDetailInEditMode(): Promise<TestRenderer.ReactTestRenderer> {
  mockedGetTaste.mockResolvedValueOnce(taste())
  let renderer!: TestRenderer.ReactTestRenderer
  await act(async () => {
    renderer = TestRenderer.create(<DetailView />)
  })
  // Tap the Edit button to enter edit mode
  const editBtn = renderer.root.findAll((node) => (node.type as unknown) === 'Button')
    .find((node) => node.children.includes('edit'))
  await act(async () => {
    editBtn?.props.onPress()
  })
  return renderer
}

function allTagChips(renderer: TestRenderer.ReactTestRenderer) {
  return renderer.root.findAll((node) => (node.type as unknown) === 'Tag')
}

describe('DetailView edit-mode tag chips — library tag visible and toggleable', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders a chip for the library-only tag "CustomTag" (not in TAG_CHOICES)', async () => {
    const renderer = await renderDetailInEditMode()
    const chips = allTagChips(renderer)
    const names = chips.map((c) => c.props.children)
    // Built-ins must still be present
    expect(names).toContain('Coffee')
    expect(names).toContain('Dessert')
    // Library-only tag must appear too
    expect(names).toContain('CustomTag')
  })

  it('CustomTag chip is initially inactive (taste has no CustomTag)', async () => {
    const renderer = await renderDetailInEditMode()
    const customChip = allTagChips(renderer).find((c) => c.props.children === 'CustomTag')
    expect(customChip).toBeTruthy()
    expect(customChip!.props.active).toBe(false)
  })

  it('pressing CustomTag chip toggles it to active', async () => {
    const renderer = await renderDetailInEditMode()
    const customChip = () => allTagChips(renderer).find((c) => c.props.children === 'CustomTag')!
    expect(customChip().props.active).toBe(false)
    await act(async () => {
      customChip().props.onPress()
    })
    expect(customChip().props.active).toBe(true)
  })

  it('legacy tag on item but not in any list still appears in edit chips', async () => {
    // taste has a legacy tag 'LegacyTag' not in TAG_CHOICES or library
    mockedGetTaste.mockResolvedValueOnce(taste({ tags: ['Coffee', 'LegacyTag'] }))
    let renderer!: TestRenderer.ReactTestRenderer
    await act(async () => {
      renderer = TestRenderer.create(<DetailView />)
    })
    const editBtn = renderer.root.findAll((node) => (node.type as unknown) === 'Button')
      .find((node) => node.children.includes('edit'))
    await act(async () => {
      editBtn?.props.onPress()
    })
    const names = allTagChips(renderer).map((c) => c.props.children)
    expect(names).toContain('LegacyTag')
  })
})
