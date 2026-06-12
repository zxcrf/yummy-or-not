/**
 * Jest config for the Expo / React Native mobile app.
 * Uses the official `jest-expo` preset so React Native components render
 * under jsdom-free RN test environment with the Expo module mocks.
 */
module.exports = {
  preset: 'jest-expo',
  // Register the AsyncStorage mock (shared taste-cache hook reads/writes it).
  setupFiles: ['<rootDir>/jest.setup.js'],
  // Map the `@/*` path alias used across the app (mirrors tsconfig paths).
  moduleNameMapper: {
    // Dedupe React to a single instance. Under pnpm the app and
    // react-test-renderer resolve `react` via different path strings (symlink
    // vs .pnpm dir); jest registers them as two module instances, so the hooks
    // dispatcher set by the renderer isn't the one a component's useState reads
    // → "Invalid hook call". Pin both to one resolved copy.
    '^react$': require.resolve('react'),
    '^@/(.*)$': '<rootDir>/$1',
    '^react-native-reanimated$': '<rootDir>/__mocks__/react-native-reanimated.js',
    // Redirect dynamic import('expo-secure-store') to our CJS stub so
    // writeStoredToken in AuthProvider works under Jest without
    // --experimental-vm-modules.
    '^expo-secure-store$': '<rootDir>/__mocks__/expo-secure-store.js',
    '^react-native-view-shot$': '<rootDir>/__mocks__/react-native-view-shot.js',
    '^expo-sharing$': '<rootDir>/__mocks__/expo-sharing.js',
    // Map workspace package to its TypeScript source — no build step needed.
    '^@yon/shared$': '<rootDir>/../../packages/shared/src/index.ts',
    '^@yon/shared/(.*)$': '<rootDir>/../../packages/shared/src/$1.ts',
  },
  testMatch: ['**/__tests__/**/*.test.{ts,tsx}'],
}
