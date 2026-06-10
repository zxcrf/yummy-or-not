import TestRenderer, { act } from 'react-test-renderer'
import { Platform } from 'react-native'

import { LangSwitcher } from '../LangSwitcher'

describe('LangSwitcher flag trigger', () => {
  const realOS = Platform.OS

  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: realOS })
  })

  it('pins visual-centering text props on Android', async () => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' })

    let renderer!: TestRenderer.ReactTestRenderer
    await act(async () => {
      renderer = TestRenderer.create(
        <LangSwitcher
          value="zh"
          triggerMode="flag"
          languages={[{ code: 'zh', label: 'Chinese', native: '中文' }]}
        />,
      )
    })

    const flagText = renderer.root.findAll(
      (node) => typeof node.props.children === 'string' && node.props.children === '🇨🇳',
    )[0]

    expect(flagText.props.lineHeight).toBe(22)
    expect(flagText.props.textAlign).toBe('center')
    expect(flagText.props.style).toEqual(
      expect.objectContaining({
        includeFontPadding: false,
        textAlignVertical: 'center',
      }),
    )
  })
})
