# Yummy or Not

A personal **tasted-log**: snap a photo or jot a note on a food/drink you bought,
record a one-tap verdict — **YUM / MEH / NAH** — and the app remembers for you.
Next time you're about to spend, a quick search tells you what past-you thought.

Fully internationalized (中文 default, English, 한국어, 日本語, Español) with the
verdicts localized too.

## Repo layout (pnpm + turbo monorepo)

```
apps/
  api/        # Next.js 15 (App Router) — API routes + embedded web SPA assets
  mobile/     # Expo / React Native (Android APK via EAS) + RN-Web
packages/
  shared/     # shared types, search, i18n locales, API contract
docs/
  ops/infra.md       # production topology, R2, backups, env, reverse geocoding
  product/           # roadmap, user stories, feature plans, known issues
```

> Web SPA maintenance is paused (2026-06-10); active targets are the **API** and
> the **Android APK**.

## Prerequisites

- Node 20+ (built on 22), pnpm 10
- PostgreSQL running locally for the API. Default connection (override in
  `apps/api/.env`): `postgresql://root@127.0.0.1:5432/yon`

## Setup

```bash
pnpm install        # install all workspace deps
pnpm dev            # turbo: start API dev server (+ mobile, see below)
pnpm test           # turbo: run all package tests (jest)
pnpm typecheck      # turbo: tsc across packages
```

Mobile (Expo) runs from its own package:

```bash
cd apps/mobile
pnpm start          # Expo dev server (Android emulator / device)
```

Release APKs are built with EAS; `EXPO_PUBLIC_API_URL` is **baked into the
build** (see `apps/mobile/eas.json`) — changing the API host requires a rebuild.

## What works

- **Library** — browse your tastes, unified search by name/place/tag, custom tag
  library.
- **Recall** — "tasted it before?" search → verdict on file (multi-result match,
  nearby-eaten grouping by location), or a "log it now" empty state.
- **Add a taste** — name / place / price / verdict / tags / note, photo upload
  with on-server transcoding to multi-size variants (thumb / display / original),
  optional capture location.
- **Detail** — full record with the verdict stamp; edit and delete.
- **Stats** — verdict breakdown, money saved, purchase ledger / repeat-buy
  warnings.
- **Accounts** — multi-user auth (email/password, phone OTP, Google/Apple/WeChat
  OAuth)
  with per-user data isolation; Free/Pro plans (record cap, original-photo
  access) and promo-code redemption.

## Production

Self-hosted: Docker (`ghcr.io/zxcrf/yum-api`) behind Caddy at
`https://yon.baobao.click`, with self-hosted PostgreSQL 17 and Cloudflare R2
(private bucket, presigned URLs) for photos. Full topology, backup, and
environment details: [`docs/ops/infra.md`](docs/ops/infra.md).
