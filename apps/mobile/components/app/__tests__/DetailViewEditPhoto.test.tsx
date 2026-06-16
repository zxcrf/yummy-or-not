/* ============================================================
   Regression test — issue #129.

   User feedback: a taste created WITHOUT a photo (name/price/notes only) could
   never gain one, because the detail-screen edit mode exposed no photo control
   at all. This pins the specific regression: in edit mode the editor must render
   an "add / change photo" affordance (testID="edit-photo-picker").

   Fails against the pre-fix DetailView (no affordance exists); passes once the
   edit-mode photo picker is wired in. The richer "picked photo flows through
   updateTaste" assertion is added alongside the implementation.
   ============================================================ */

import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { getTaste, updateTaste, type Taste } from '@yon/shared'

import DetailView from '../DetailView'

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

jest.mock('@/components/ds', () => {
  const React = require('react')
  return {
    Badge: ({ children, ...props }: { children?: React.ReactNode }) =>
      React.createElement('Badge', props, children),
    Button: ({ children, ...props }: { children?: React.ReactNode }) =>
      React.createElement('Button', props, children),
    Card: ({ children, ...props }: { children?: React.ReactNode }) =>
      React.createElement('Card', props, children),
    EditActionHeader: (props: Record<string, unknown>) =>
      React.createElement('EditActionHeader', props),
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
    notes: 'Too bitter',
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

function buttons(renderer: TestRenderer.ReactTestRenderer) {
  return renderer.root.findAll((node) => (node.type as unknown) === 'Button')
}

describe('DetailView edit-mode photo (issue #129)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders an add-photo affordance in edit mode when the record has no image', async () => {
    mockedGetTaste.mockResolvedValueOnce(taste({ image: '', imageThumb: '' }))
    const renderer = await renderDetail()

    const edit = buttons(renderer).find((b) => b.children.includes('edit'))
    await act(async () => {
      edit?.props.onPress()
    })

    // The whole point of #129: a record with no photo must offer a way to add one.
    const picker = renderer.root.findAll((node) => node.props?.testID === 'edit-photo-picker')
    expect(picker.length).toBeGreaterThan(0)
  })
})
