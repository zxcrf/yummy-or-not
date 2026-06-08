# Local Android dev (fast inner loop)

Local `expo run:android` for dev verification (~1–3 min incremental rebuilds).
EAS cloud is reserved for CI release builds (see `.github/workflows/eas-release.yml`).

## One-time toolchain (macOS, Apple Silicon)

Use a **standard OpenJDK 17** — GraalVM 17 fails the Android `JdkImageTransform`
(`:react-native-worklets:compileDebugJavaWithJavac` → `core-for-system-modules.jar`).

```bash
brew install openjdk@17                                # standard JDK (no sudo; keg-only)
brew install --cask android-commandlinetools          # sdkmanager
export ANDROID_HOME="$HOME/Library/Android/sdk"
sdkmanager --sdk_root="$ANDROID_HOME" --licenses       # accept all
sdkmanager --sdk_root="$ANDROID_HOME" \
  "platform-tools" "emulator" \
  "platforms;android-36" "platforms;android-35" \
  "build-tools;36.0.0" "build-tools;35.0.0" \
  "ndk;27.1.12297006" "cmake;3.22.1"
```

Add to `~/.zshrc` (then `source ~/.zshrc`):

```bash
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$PATH:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$ANDROID_HOME/cmdline-tools/latest/bin"
export JAVA_HOME="/opt/homebrew/opt/openjdk@17"
```

(cmdline-tools from brew live at `/opt/homebrew/share/android-commandlinetools/...`;
they're symlinked into `$ANDROID_HOME/cmdline-tools/latest` for the canonical layout
Expo/gradle expect.)

## Dev loop (real device — recommended)

1. Phone: enable **Developer options** → **USB debugging**, plug in USB, accept the RSA prompt.
2. Confirm: `adb devices` shows your device.
3. From `apps/mobile`:
   ```bash
   bunx expo run:android       # first run prebuilds android/ + gradle (~10 min), installs, starts Metro
   ```
4. Edit code → it hot-reloads. Native change → re-run `expo run:android` (incremental, ~1–3 min).

`EXPO_PUBLIC_API_URL` for local dev points at the live API via `eas.json`'s profile env, or set inline:
`EXPO_PUBLIC_API_URL=https://yon.baobao.click bunx expo run:android`.

> **⚠️ Local Gradle builds**: `eas.json` env vars are EAS-cloud-only. For
> `./gradlew :app:assembleRelease` you MUST set the var in the shell:
> ```bash
> EXPO_PUBLIC_API_URL=https://yon.baobao.click JAVA_HOME=/opt/homebrew/opt/openjdk@17 \
>   ./gradlew :app:assembleRelease
> ```
> Without it `BASE_URL` falls back to `""` (same-origin), and all API calls fail on device.

## Emulator (optional, if no device)

```bash
sdkmanager --sdk_root="$ANDROID_HOME" "system-images;android-36;google_apis;arm64-v8a"
avdmanager create avd -n pixel -k "system-images;android-36;google_apis;arm64-v8a" -d pixel_7
emulator -avd pixel &        # then: bunx expo run:android
```

## Notes

- `android/` and `ios/` are gitignored (managed workflow — `expo prebuild` regenerates them). Don't commit them.
- The repo's `.npmrc` (`node-linker=hoisted`) is required for RN native-module autolinking — local AND EAS.
- **Do not use GraalVM 17** — it fails the Android `JdkImageTransform`. Use `brew install openjdk@17` (keg-only, no sudo) and set `JAVA_HOME=/opt/homebrew/opt/openjdk@17`.

## CI release (EAS)

`.github/workflows/eas-release.yml` builds on `v*` tags (or manual dispatch):
- `production` profile → AAB (Play Store) · `preview` → APK (sideload)
- Requires repo secret **`EXPO_TOKEN`** (create at https://expo.dev → Account → Access Tokens).
- Local verification first → tag `vX.Y.Z` → CI builds the release artifact on EAS.
