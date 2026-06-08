/**
 * Jest config for the Expo / React Native mobile app.
 * Uses the official `jest-expo` preset so React Native components render
 * under jsdom-free RN test environment with the Expo module mocks.
 */
module.exports = {
  preset: 'jest-expo',
  // Map the `@/*` path alias used across the app (mirrors tsconfig paths).
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
    // Redirect Tamagui to a CJS stub — pnpm stores Tamagui as ESM which Jest
    // cannot transform. The stub is sufficient for unit tests that only exercise
    // non-UI logic or exported constants.
    '^tamagui$': '<rootDir>/__mocks__/tamagui.js',
    '^@tamagui/(.*)$': '<rootDir>/__mocks__/tamagui.js',
  },
  testMatch: ['**/__tests__/**/*.test.{ts,tsx}'],
}
