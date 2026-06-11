/* ============================================================
   Regression tests — editing a taste from its detail screen.

   Bug: tapping Edit on a taste detail did nothing because the button had no
   handler. The detail flow must expose editable fields and persist changes via
   PATCH so users can fix an existing taste without recreating it.
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

// DetailView invalidates the shared taste cache after save/delete; that hook
// has its own suite, so stub it to a no-op here.
jest.mock('@/app/(tabs)/_useTastes', () => ({
  invalidateTastes: jest.fn(async () => []),
  // Edit flow exercises the cache-MISS path (item loads via getTaste mock).
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

function inputByLabel(renderer: TestRenderer.ReactTestRenderer, label: string) {
  return renderer.root.findAll((node) => (node.type as unknown) === 'Input')
    .find((node) => node.props.label === label)
}

describe('DetailView editing', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('opens editable fields when Edit is tapped', async () => {
    mockedGetTaste.mockResolvedValueOnce(taste())
    const renderer = await renderDetail()

    const edit = buttons(renderer).find((button) => button.children.includes('edit'))
    expect(edit?.props.onPress).toEqual(expect.any(Function))

    await act(async () => {
      edit?.props.onPress()
    })

    const nameInput = inputByLabel(renderer, 'f_what')
    expect(nameInput).toBeTruthy()
    expect(nameInput?.props.value).toBe('Espresso')
  })

  it('saves edited detail fields through updateTaste and returns to read mode', async () => {
    mockedGetTaste.mockResolvedValueOnce(taste())
    mockedUpdateTaste.mockResolvedValueOnce(taste({ name: 'Cortado', notes: 'Better now' }))
    const renderer = await renderDetail()

    const edit = buttons(renderer).find((button) => button.children.includes('edit'))
    await act(async () => {
      edit?.props.onPress()
    })

    const nameInput = inputByLabel(renderer, 'f_what')
    await act(async () => {
      nameInput?.props.onChangeText('Cortado')
    })

    const notes = renderer.root.find((node) => (node.type as unknown) === 'Textarea')
    await act(async () => {
      notes.props.onChangeText('Better now')
    })

    const save = buttons(renderer).find((button) => button.children.includes('save_taste_web'))
    await act(async () => {
      await save?.props.onPress()
    })

    expect(mockedUpdateTaste).toHaveBeenCalledWith('taste-1', {
      name: 'Cortado',
      place: 'Corner Cafe',
      price: '4.00',
      verdict: 'yum',
      tags: ['Coffee'],
      notes: 'Better now',
    })
    expect(inputByLabel(renderer, 'f_what')).toBeUndefined()
    expect(renderer.root.findAll((node) => node.children.includes('Cortado'))).not.toHaveLength(0)
  })
})
