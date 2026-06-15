# Maestro E2E — real-device APK testing

Pre-release smoke against the **same APK you ship**. Maestro drives the
installed app over ADB — no source instrumentation, no EAS dependency.

## Layout

```
.maestro/
  config.yaml          # disableAnimations (flake killer), flow list
  flows/               # full journeys, run in filename order
    01-launch.yaml     # launches, asserts first screen (locale-agnostic)
    02-nav-smoke.yaml  # login -> walk tabs -> assert You-tab testID
  subflows/
    login.yaml         # reusable email login (skips if already authed)
  .env.example         # copy to .env.local, fill creds (gitignored)
```

## One-time setup

```bash
# 1. install maestro CLI (installs to ~/.maestro/bin)
curl -Ls "https://get.maestro.mobile.dev" | bash
export PATH="$PATH:$HOME/.maestro/bin"      # add to shell rc

# 2. creds
cp .maestro/.env.example .maestro/.env.local   # edit EMAIL/PASSWORD
```

## Get a device + the APK

Maestro needs ONE attached device with the app installed:

```bash
# real phone: enable USB debugging, plug in
adb devices                                  # must list a device

# OR boot an emulator
emulator -list-avds && emulator -avd <name> &

# build + install the EXACT artifact you ship
eas build -p android --profile preview       # cloud build -> download .apk
adb install -r path/to/app.apk
# app id: com.yummyornot.app
```

## Run

```bash
# single flow
maestro test .maestro/flows/01-launch.yaml -e MAESTRO_APP_ID=com.yummyornot.app

# whole suite via npm (loads .env.local)
pnpm --filter @yon/mobile e2e:android

# interactive element inspector (great for authoring)
maestro studio
```

## Conventions

- **Selectors**: testID > accessibilityLabel > text > index. Index = last resort.
- **No `wait: N`** — use `extendedWaitUntil` / `assertVisible` (auto-retry).
- **Animations**: `disableAnimations: true` in config; add `waitForAnimationToEnd`
  around custom transitions if needed.
- **Locale**: UI strings are i18n (device locale, en fallback). Flows match
  text by regex across locales — prefer adding a `testID` for anything load-bearing.
- **Deterministic state**: real-data flakiness needs a dev-only backend reset
  endpoint + DB seed before runs. Not built yet — see TODO below.

## TODO before this is CI-ready

- [ ] Add `testID`s to AuthScreen inputs (currently matched by placeholder text).
- [ ] Dev-only `/api/test/reset` endpoint + `subflows/reset.yaml` for clean state.
- [ ] GitHub Actions job: boot emulator, `adb install`, run suite, upload artifacts.
