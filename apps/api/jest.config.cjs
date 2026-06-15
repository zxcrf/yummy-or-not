/** @type {import('@jest/types').Config.InitialOptions} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  // @swc/jest: single-file transpile via Rust, no cross-file type resolution —
  // keeps tests fast and independent of the @yon/shared workspace symlink at test time.
  transform: {
    '^.+\\.tsx?$': ['@swc/jest', {
      jsc: {
        parser: { syntax: 'typescript', decorators: true },
        target: 'es2020',
      },
    }],
  },
  // Mirror tsconfig's "@/*" path alias so route handlers (which import
  // "@/lib/...") resolve under @swc/jest.
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
};
