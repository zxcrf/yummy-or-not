/**
 * Jest setup — runs before each test file.
 * Registers the official AsyncStorage mock so modules that read/write the
 * shared taste cache (app/(tabs)/_useTastes) work under the test environment
 * without a native module.
 */
jest.mock(
  '@react-native-async-storage/async-storage',
  () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
)

jest.mock('react-native-keyboard-controller', () =>
  require('react-native-keyboard-controller/jest'),
)

// Provide a zero-insets fallback for all suites so components that call
// useSafeAreaInsets() don't throw "No safe area value available". Suites
// that need non-zero insets (e.g. DetailViewEdit double-inset regression)
// override this mock inline with jest.mock('react-native-safe-area-context', …).
jest.mock('react-native-safe-area-context', () =>
  require('react-native-safe-area-context/jest/mock').default,
)
