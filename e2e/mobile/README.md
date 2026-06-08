# Mobile Expo Web E2E

Playwright starts the local Next API and Expo Web app, then runs a real browser
flow against the mobile web UI.

## Run

Prepare a local database first. The existing setup script drops and recreates
tables, so use a disposable database:

```bash
DATABASE_URL=postgresql://root@127.0.0.1:5432/yon_e2e pnpm --filter @yon/api db:setup
DATABASE_URL=postgresql://root@127.0.0.1:5432/yon_e2e pnpm e2e:mobile
```

The test logs in with the seeded demo account, edits `matcha`, verifies the
change survives reload, then restores the original seed row.

## Current Status

- Added a runnable Playwright harness for Expo Web + API.
- Added one detail-edit regression flow in `detail-edit.spec.ts`.
- Confirmed Playwright config parsing with `pnpm exec playwright test --list`.
- First full run timed out waiting for Expo Web because the config used
  `127.0.0.1`; Expo Web was only reachable via `localhost`. The config now uses
  `http://localhost:19006`.

## TODO

- Rerun the full e2e flow against a prepared disposable database.
- If RN Web accessibility locators are unstable in Chromium, add minimal
  production-safe accessibility labels to the affected controls.
- Add CI wiring once the project has a dedicated PostgreSQL service for e2e.
