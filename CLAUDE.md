# Yummy or Not — repo conventions

## Unit tests are required for user-level feedback

Any fix that addresses **user-level feedback** (a bug report, crash, or
behavior complaint that a real user could hit) MUST ship with a complete unit
test that:

1. **Reproduces the reported failure** — the test must fail against the old
   (buggy) code and pass against the fix. Verify both directions before
   considering the work done.
2. **Pins the specific regression**, not just a happy path. Assert on the exact
   thing that broke (e.g. the component/element actually rendered, the value
   passed through, the error no longer thrown).
3. **Lives next to the code** under a `__tests__/` directory and runs in CI via
   the package's `test` script (`pnpm --filter <pkg> test`, wired through
   `turbo run test`).

If the affected package has no test setup yet, add it as part of the fix
(mobile uses `jest` + the `jest-expo` preset + `react-test-renderer`).

Example: the AddModal photo-preview crash on native
(`apps/mobile/components/app/__tests__/PhotoPreview.test.tsx`) — the preview
used a raw HTML `<img>`, so the test asserts a real React Native `<Image>`
renders and that no raw `img` element appears in the tree.
