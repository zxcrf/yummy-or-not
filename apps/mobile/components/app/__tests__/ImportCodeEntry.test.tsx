/* ============================================================
   Tests — ImportCodeEntry 口令 strip (S3a manual entry).

   Regression: pasting a full 【YON口令】GWFVYRKFQU【/YON】 wrapper into the
   manual-entry field sent the raw delimited string to resolveImportCode,
   which 404s because the server only knows the bare code.

   Fix: handleLookup applies parseShareToken(trimmed) ?? trimmed before
   calling resolveImportCode, so wrapped input resolves to the inner code
   while bare codes continue to work unchanged.

   Pins:
   1. Wrapped 口令 → resolver called with the bare inner code (GWFVYRKFQU).
   2. Bare code → resolver called with the bare code as-is.
   3. Surrounding text around wrapper → inner code extracted correctly.
   ============================================================ */

import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'

import ImportCodeEntry from '../ImportCodeEntry'

// ── shared: real codec + mocked resolveImportCode ────────────────────────────
const mockResolveImportCode = jest.fn()

jest.mock('@yon/shared', () => {
  const actual = jest.requireActual('@yon/shared')
  return {
    parseShareToken: actual.parseShareToken,
    resolveImportCode: (...a: unknown[]) => mockResolveImportCode(...a),
  }
})

// ── router ────────────────────────────────────────────────────────────────────
const mockReplace = jest.fn()
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace }),
}))

// ── i18n ─────────────────────────────────────────────────────────────────────
jest.mock('@/providers/I18nProvider', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

// ── design-system stubs ───────────────────────────────────────────────────────
jest.mock('@/components/ds', () => {
  const React = require('react')
  const mk = (name: string) =>
    ({ children, onPress, onChangeText, value, testID, ...rest }: {
      children?: React.ReactNode
      onPress?: () => void
      onChangeText?: (v: string) => void
      value?: string
      testID?: string
      [key: string]: unknown
    }) =>
      React.createElement(name, { onPress, onChangeText, value, testID, ...rest }, children)
  return {
    Button: mk('Button'),
    Input: mk('Input'),
  }
})

// ── theme stub ────────────────────────────────────────────────────────────────
jest.mock('@/theme', () => ({
  colors: { background: '#fff', ink900: '#000', ink700: '#333' },
  space: { 3: 12, 4: 16 },
  Text: ({ children, ...props }: { children?: React.ReactNode }) =>
    require('react').createElement('Text', props, children),
}))

// ── helpers ───────────────────────────────────────────────────────────────────
const mountedRenderers: TestRenderer.ReactTestRenderer[] = []

afterEach(() => {
  act(() => {
    mountedRenderers.forEach((r) => r.unmount())
  })
  mountedRenderers.length = 0
  jest.clearAllMocks()
})

async function renderEntry(): Promise<TestRenderer.ReactTestRenderer> {
  let r!: TestRenderer.ReactTestRenderer
  await act(async () => {
    r = TestRenderer.create(<ImportCodeEntry />)
  })
  mountedRenderers.push(r)
  return r
}

function findByTestID(r: TestRenderer.ReactTestRenderer, id: string) {
  return r.root.findAll((n) => n.props?.testID === id)[0]
}

async function typeCode(r: TestRenderer.ReactTestRenderer, value: string) {
  const input = findByTestID(r, 'import-code-input')
  await act(async () => {
    input.props.onChangeText(value)
  })
}

async function pressSubmit(r: TestRenderer.ReactTestRenderer) {
  const btn = findByTestID(r, 'import-code-submit')
  await act(async () => {
    btn.props.onPress()
    await Promise.resolve()
  })
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('ImportCodeEntry — 口令 strip on manual entry', () => {
  it('wrapped 口令 → resolver receives the bare inner code (regression)', async () => {
    mockResolveImportCode.mockResolvedValueOnce({ token: 'tok-1' })
    const r = await renderEntry()

    await typeCode(r, '【YON口令】GWFVYRKFQU【/YON】')
    await pressSubmit(r)

    expect(mockResolveImportCode).toHaveBeenCalledTimes(1)
    expect(mockResolveImportCode).toHaveBeenCalledWith('GWFVYRKFQU')
  })

  it('bare code with no wrapper → resolver receives the trimmed bare code', async () => {
    mockResolveImportCode.mockResolvedValueOnce({ token: 'tok-2' })
    const r = await renderEntry()

    await typeCode(r, 'GWFVYRKFQU')
    await pressSubmit(r)

    expect(mockResolveImportCode).toHaveBeenCalledTimes(1)
    expect(mockResolveImportCode).toHaveBeenCalledWith('GWFVYRKFQU')
  })

  it('wrapper with surrounding text → inner code extracted correctly', async () => {
    mockResolveImportCode.mockResolvedValueOnce({ token: 'tok-3' })
    const r = await renderEntry()

    await typeCode(r, '朋友分享 【YON口令】GWFVYRKFQU【/YON】 快来')
    await pressSubmit(r)

    expect(mockResolveImportCode).toHaveBeenCalledTimes(1)
    expect(mockResolveImportCode).toHaveBeenCalledWith('GWFVYRKFQU')
  })
})
