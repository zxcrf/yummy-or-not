/* ============================================================
   Tests — ImportCodeEntry 口令 strip (S3a manual entry) + EditActionHeader.

   Regression: pasting a full 【YON口令】GWFVYRKFQU【/YON】 wrapper into the
   manual-entry field sent the raw delimited string to resolveImportCode,
   which 404s because the server only knows the bare code.

   Fix: handleLookup applies parseShareToken(trimmed) ?? trimmed before
   calling resolveImportCode, so wrapped input resolves to the inner code
   while bare codes continue to work unchanged.

   Header refactor (ADR 0001): the primary 查找/look-up command moved from an
   inline body <Button> to the shared EditActionHeader's primary slot (still
   testID="import-code-submit"), and a cancel control (router.back) now lives
   top-left. There must be NO inline body primary Button left.

   Pins:
   1. Wrapped 口令 → resolver called with the bare inner code (GWFVYRKFQU).
   2. Bare code → resolver called with the bare code as-is.
   3. Surrounding text around wrapper → inner code extracted correctly.
   4. Header: cancel → router.back(); submit (header) resolves → router.replace.
   5. Header submit disabled when code empty / while loading.
   6. No inline body primary Button remains; title + hint still render.
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
const mockBack = jest.fn()
const mockCanGoBack = jest.fn(() => true)
jest.mock('expo-router', () => ({
  useRouter: () => ({
    replace: mockReplace,
    back: mockBack,
    canGoBack: mockCanGoBack,
  }),
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
  // EditActionHeader stub: surface cancel + primary as discrete nodes so tests
  // can find them by testID and assert disabled/label, plus render the title.
  const EditActionHeader = ({
    title,
    onCancel,
    cancelLabel,
    cancelTestID,
    onPrimary,
    primaryLabel,
    primaryDisabled,
    primaryLoading,
    primaryTestID,
    testID,
  }: {
    title: string
    onCancel: () => void
    cancelLabel: string
    cancelTestID?: string
    onPrimary: () => void
    primaryLabel: string
    primaryDisabled?: boolean
    primaryLoading?: boolean
    primaryTestID?: string
    testID?: string
  }) =>
    React.createElement('EditActionHeader', { testID }, [
      React.createElement('Cancel', { key: 'c', testID: cancelTestID, onPress: onCancel }, cancelLabel),
      React.createElement('Title', { key: 't' }, title),
      React.createElement(
        'Primary',
        { key: 'p', testID: primaryTestID, onPress: onPrimary, disabled: primaryDisabled, loading: primaryLoading },
        primaryLabel,
      ),
    ])

  return {
    Button: mk('Button'),
    Input: mk('Input'),
    EditActionHeader,
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

describe('ImportCodeEntry — EditActionHeader (ADR 0001)', () => {
  it('cancel control calls router.back() when back stack exists', async () => {
    mockCanGoBack.mockReturnValue(true)
    const r = await renderEntry()
    const cancel = findByTestID(r, 'import-code-cancel')
    expect(cancel).toBeTruthy()
    await act(async () => {
      cancel.props.onPress()
    })
    expect(mockBack).toHaveBeenCalledTimes(1)
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it('cancel falls back to /(tabs) on cold deep-link entry (no back stack) — regression', async () => {
    // Simulate cold start: no prior navigation history.
    mockCanGoBack.mockReturnValue(false)
    const r = await renderEntry()
    const cancel = findByTestID(r, 'import-code-cancel')
    expect(cancel).toBeTruthy()
    await act(async () => {
      cancel.props.onPress()
    })
    // Must navigate home, not be a no-op.
    expect(mockReplace).toHaveBeenCalledWith('/(tabs)')
    expect(mockBack).not.toHaveBeenCalled()
  })

  it('header submit resolves the code then routes to /import/<token>', async () => {
    mockResolveImportCode.mockResolvedValueOnce({ token: 'tok-9' })
    const r = await renderEntry()

    await typeCode(r, 'GWFVYRKFQU')
    await pressSubmit(r)

    expect(mockResolveImportCode).toHaveBeenCalledWith('GWFVYRKFQU')
    expect(mockReplace).toHaveBeenCalledWith('/import/tok-9')
  })

  it('header submit is disabled while the code is empty', async () => {
    const r = await renderEntry()
    const submit = findByTestID(r, 'import-code-submit')
    expect(submit.props.disabled).toBe(true)
  })

  it('header submit becomes enabled once a code is entered', async () => {
    const r = await renderEntry()
    await typeCode(r, 'GWFVYRKFQU')
    const submit = findByTestID(r, 'import-code-submit')
    expect(submit.props.disabled).toBe(false)
  })

  it('the primary command lives only in the header — no inline body Button', async () => {
    const r = await renderEntry()
    // The ds stub renders an inline body primary as <Button> and the header's
    // primary slot as <Primary>. After the refactor there must be no <Button>
    // host node at all, and the single import-code-submit node must be the
    // header's <Primary> slot — not an inline body Button.
    const buttons = r.root.findAll((n) => n.type === ('Button' as unknown as typeof n.type))
    expect(buttons.length).toBe(0)
    const submits = r.root.findAll((n) => n.props?.testID === 'import-code-submit')
    expect(submits.length).toBe(1)
    expect(submits[0].type).toBe('Primary')
  })

  it('title (import_code_entry) and hint (import_code_hint) still render', async () => {
    const r = await renderEntry()
    const texts = r.root
      .findAll((n) => typeof n.props?.children === 'string')
      .map((n) => n.props.children as string)
    expect(texts).toContain('import_code_entry')
    expect(texts).toContain('import_code_hint')
  })
})
