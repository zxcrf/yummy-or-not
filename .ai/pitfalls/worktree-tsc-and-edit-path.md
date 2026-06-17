# Pitfall: fresh git worktree has no node_modules → tsc noise + symlink scope-creep, and Edit/Read default to the main checkout path

**Date:** 2026-06-18 · **Related:** PR #151 (issue #149 view-original overlay), CLAUDE.md main-branch protection

## Symptom

Two distinct traps hit while doing `/my-issue` work inside a `.worktrees/<name>` worktree:

1. **`npx tsc --noEmit` in the worktree reports ~100 errors** — every file that
   imports `@yon/shared` fails with `TS2307: Cannot find module '@yon/shared'`,
   plus a cascade of `TS7006 implicit any` on params typed by those imports.
   Meanwhile `jest` runs perfectly green (698/698). Confusing: tests pass but
   "the types are broken".
2. **Edited the wrong copy of a file.** Test edits "didn't take" — jest in the
   worktree kept running the OLD test (old test names in output) and the
   protected `main` working tree showed `M` on those files.

## Root cause

- `git worktree add` does **not** create `node_modules` (it's gitignored). jest
  resolves modules via its own config/haste pointed at the root checkout, so it
  works; `tsc` has no `node_modules` in the worktree and cannot resolve the
  `@yon/shared` workspace package → the whole type graph collapses.
- The Read/Edit/Write tools take **absolute paths**. After reading a file from
  the main checkout path (`<repo>/apps/...`), subsequent Edits defaulted to that
  same main-checkout path — editing `main` (a protected branch) instead of
  `<repo>/.worktrees/<name>/apps/...`.

## Fix / Prevention

- **Edit path discipline:** in worktree workflows, always target
  `<repo>/.worktrees/<name>/...` in every Read/Edit/Write. Re-derive `WT=$ROOT/.worktrees/<name>`
  and prefix paths with it. After edits, `git -C "$ROOT" status` MUST be clean
  (main untouched) and `git -C "$WT" status` shows the changes.
- **tsc in a worktree:** don't trust raw tsc there. Either run tsc in the main
  checkout, or symlink deps:
  `ln -s "$ROOT/node_modules" "$WT/node_modules"` (+ `apps/mobile`, `packages/shared`).
  After symlinking, the count drops to only the genuinely-new errors.
- **⚠️ Symlink scope-creep:** a symlink literally named `node_modules` is NOT
  matched by a `node_modules/` directory `.gitignore` pattern, so `git add -A`
  **stages it** and it lands in the diff (a cross-model reviewer flagged this as
  a [BLOCK]). Always `rm` the symlinks before `git add`, and check
  `git diff --cached --stat` shows only intended files.
