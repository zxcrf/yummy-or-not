# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v56.0.0/ before writing any code.

# Building the APK — GHA for dev, EAS only for release

- **Nightly / dev / "build an APK to check a change" → GitHub Actions**, never a
  manual `eas build`. `.github/workflows/android-apk.yml` auto-runs on push to main
  (when `apps/mobile/` or `packages/shared/` change), so a merge ALREADY builds the
  APK. Grab it: `gh run download <run-id> -n app-release-<sha>`. Manual:
  `gh workflow run android-apk.yml`. No login, no rate limit.
- **EAS cloud build = release versioning ONLY.** Before a release, bring the EAS
  build to full parity with the GHA build (env, baked `EXPO_PUBLIC_API_URL` + other
  baked vars, signing/keystore) — outputs must be functionally identical. Do NOT use
  EAS for dev/nightly.

# UX docs — read on demand, not upfront

- Touching keyboard / inputs / forms / `KeyboardAvoidingView` / sticky footers:
  read `../../docs/product/keyboard-ux.md` first (keyboard strategy, animation
  sync rules, acceptance checklist).
- Adding press feedback / transitions / enter-exit animations:
  read `../../docs/product/material-motion.md` first (animation presets and
  per-component patterns already in use).
- Writing jest tests that mount components, or debugging "all tests pass but
  jest exits 1 on CI": read `../../docs/engineering/jest-async-leaks.md` first
  (async-act mounts, afterEach unmount, act-warning gate, no --forceExit).
