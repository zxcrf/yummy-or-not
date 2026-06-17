---
name: yon-release
description: "Cut an Android APK release: bump version + versionCode, tag v<x.y.z>, trigger the GHA build, and download the artifact. Use when: '打tag', '发apk', '出包', '发版', 'release apk', 'cut a release', 'build a release apk'. APK builds on `v*` tag push via android-apk.yml; day-to-day ad-hoc builds use `gh workflow run android-apk.yml` instead."
---

# yon-release — Tag a version and ship the Android APK

Cuts a proper release: bumps the mobile version + `versionCode`, lands it on
`main` via PR (main is protected — no direct commits), pushes a `v<x.y.z>` tag
which triggers `.github/workflows/android-apk.yml`, then downloads the built APK.

**When NOT to use this:** for a throwaway build of the current `main` (no version
bump), just run `gh workflow run android-apk.yml` and `gh run download`. This skill
is for versioned releases that should install as an upgrade over the previous APK.

## Why a version bump is mandatory

Android refuses to install an APK whose `versionCode` is **≤** the installed one.
If `versionCode` doesn't increase, the new build can only be installed after
uninstalling the old app (losing local state). So **every** release MUST increment
`apps/mobile/app.json` → `expo.android.versionCode` by at least 1. The human-facing
`expo.version` (semver) bumps too, and the tag is `v<that version>`.

## Step 0 — Read current version and decide the new one

```bash
ROOT=$(git rev-parse --show-toplevel)
sed -n '1,30p' "$ROOT/apps/mobile/app.json" | grep -nE '"version"|"versionCode"'
git tag --sort=-v:refname | head -5      # existing tags, latest first
```

- Current `expo.version` (e.g. `1.0.0`) and `expo.android.versionCode` (e.g. `1`).
- Decide the bump. Default to **patch** (`1.0.0 → 1.0.1`) unless the user said
  minor/major. Always `versionCode = current + 1`.
- New tag = `v<new version>` (e.g. `v1.0.1`). **Confirm the target version+tag with
  the user before proceeding** — this is the one human gate.
- Abort if the tag already exists: `git rev-parse v<new version>` must fail.

## Step 1 — Bump version on a branch (main is protected)

```bash
ROOT=$(git rev-parse --show-toplevel)
git -C "$ROOT" fetch origin main --quiet
git -C "$ROOT" worktree add -b release/v<ver> "$ROOT/.worktrees/release-v<ver>" origin/main
```

In the worktree, edit:
- `apps/mobile/app.json`: `expo.version` → `<ver>`, `expo.android.versionCode` → `<code>`.
- `apps/mobile/package.json`: `version` → `<ver>` (keep in sync).

Commit + PR + merge (squash). End commit messages with the repo's
`Co-Authored-By` trailer.

```bash
cd "$ROOT/.worktrees/release-v<ver>"
git add apps/mobile/app.json apps/mobile/package.json
git commit -m "chore(release): bump mobile to v<ver> (versionCode <code>)"
git push -u origin release/v<ver>
gh pr create --base main --head release/v<ver> \
  --title "chore(release): v<ver>" \
  --body "Bump mobile version → v<ver>, versionCode → <code>. Tagging v<ver> after merge triggers the APK build."
# Wait for the Test check, then:
gh pr merge <pr#> --squash --delete-branch
```

Clean up:

```bash
cd "$ROOT"
git worktree remove "$ROOT/.worktrees/release-v<ver>"
git branch -D release/v<ver>
git fetch origin main --quiet
```

## Step 2 — Tag the merged commit and push

The tag must point at the **merge commit on `origin/main`** (the one carrying the
version bump), not at a stale local HEAD. Creating/pushing a tag does not modify
`main`'s tree or history, so it is allowed outside a worktree.

```bash
SHA=$(git rev-parse origin/main)
git tag -a v<ver> "$SHA" -m "release v<ver>"
git push origin v<ver>
```

Pushing `v<ver>` triggers `android-apk.yml` (its only push trigger is `tags: ['v*']`).

## Step 3 — Watch the build

```bash
sleep 5
RUN=$(gh run list --workflow=android-apk.yml --limit=1 --json databaseId,headBranch,status,createdAt \
  --jq '.[0] | select(.headBranch=="v<ver>") | .databaseId')
gh run watch "$RUN" --exit-status        # blocks until done; non-zero if the build fails
```

If `gh run watch` returns non-zero, dump logs and stop:
`gh run view "$RUN" --log-failed | tail -60`.

## Step 4 — Download the APK

The artifact name is `app-release-<full-sha>` (see `android-apk.yml`).

```bash
gh run download "$RUN" -n "app-release-$SHA" -D "$ROOT/dist/v<ver>"
ls -lh "$ROOT/dist/v<ver>/app-release.apk"
```

(`dist/` is gitignored scratch; create it if missing. Artifact retention is 1 day,
so download promptly.)

## Step 5 — Report

```
✅ Released v<ver>
  versionCode : <code>
  tag         : v<ver>  →  <SHA short 7>
  build run   : <RUN url>
  APK         : dist/v<ver>/app-release.apk  (<size>)
  API host    : https://yon.baobao.click  (baked into the APK via EXPO_PUBLIC_API_URL)
```

Remind the user: this APK points at `https://yon.baobao.click` (baked at build
time). To distribute, hand them the `.apk` file directly.

## Error handling

- **Tag already exists** (`v<ver>`): pick the next patch, or delete the bad tag with
  `git push origin :refs/tags/v<ver> && git tag -d v<ver>` only if it was never released.
- **No run appears after tag push**: confirm the trigger — `android-apk.yml` must have
  `on.push.tags: ['v*']`. A tag not matching `v*` won't build. Re-trigger manually with
  `gh workflow run android-apk.yml` (builds current main, no version guarantee).
- **Build fails on Gradle/keystore**: the release keystore + signing secrets live in GHA
  secrets (`ANDROID_KEYSTORE_*`). See the project's mobile-build memory / `eas.json`.
- **APK won't install as upgrade**: `versionCode` did not increase. Confirm Step 1 actually
  bumped `expo.android.versionCode` and the merge landed before tagging.

## Related

- Trigger config + rationale: `.github/workflows/android-apk.yml`, CLAUDE.md "APK 构建策略".
- EAS (release-store builds only, not dev): `eas.json`, mobile-build memory.
