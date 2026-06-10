'use strict'
// CJS stub for expo-secure-store — prevents "dynamic import without
// --experimental-vm-modules" errors when AuthProvider.writeStoredToken fires
// `void import('expo-secure-store')` on native (Platform.OS !== 'web').
module.exports = {
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
}
