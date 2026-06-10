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
