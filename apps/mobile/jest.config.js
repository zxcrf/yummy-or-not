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
  },
  testMatch: ['**/__tests__/**/*.test.{ts,tsx}'],
}
