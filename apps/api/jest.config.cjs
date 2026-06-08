/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  // isolatedModules: single-file transpile, no cross-file type resolution — keeps
  // tests fast and independent of the @yon/shared workspace symlink at test time.
  transform: {
    '^.+\\.ts$': ['ts-jest', { isolatedModules: true }],
  },
};
