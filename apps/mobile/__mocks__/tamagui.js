'use strict'
// Minimal CJS stub for Tamagui — prevents ESM parse errors in Jest (pnpm
// stores Tamagui as ESM which Jest cannot transform without extra config).
const React = require('react')

function noop() {}

const styled = jest.fn((Comp, _config) => {
  const Base = typeof Comp === 'string' ? Comp : 'View'
  const Mocked = React.forwardRef((props, ref) =>
    React.createElement(Base, { ...props, ref })
  )
  return Mocked
})

module.exports = {
  styled,
  View: ({ children, ...props }) => React.createElement('View', props, children),
  XStack: ({ children, ...props }) => React.createElement('View', props, children),
  YStack: ({ children, ...props }) => React.createElement('View', props, children),
  Text: ({ children, ...props }) => React.createElement('Text', props, children),
  Input: 'TextInput',
  TextArea: 'TextInput',
  ScrollView: ({ children, ...props }) => React.createElement('ScrollView', props, children),
  TamaguiProvider: ({ children }) => children,
  Theme: ({ children }) => children,
  getTokenValue: noop,
  createTamagui: noop,
  createTokens: noop,
  createTheme: noop,
}
