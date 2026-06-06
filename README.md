# Yummy or Not

A personal **tasted-log**: snap a photo or jot a note on a food/drink you bought,
record a one-tap verdict — **YUM / MEH / NAH** — and the app remembers for you.
Next time you're about to spend, a quick search tells you what past-you thought.

Built from the *Yummy or Not* design system (newtro pixel + candy-pop) as a real,
functional app: **Next.js 15 (App Router) · React 19 · TypeScript · PostgreSQL**.
One responsive UI serves both the **web dashboard** (sidebar) and the **mobile app**
(bottom tab bar + FAB). Fully internationalized (中文 default, English, 한국어, 日本語,
Español) with the verdicts localized too.

## Prerequisites

- Node 20+ (built on 22)
- PostgreSQL running locally. Default connection (override in `.env`):
  `postgresql://root@127.0.0.1:5432/yon`

## Setup

```bash
npm install          # install deps
npm run db:setup     # create the schema (users/sessions/tastes/…) + seed a demo account
npm run dev          # start the dev server → http://localhost:3000
```

Production: `npm run build && npm start`.

**Signing in.** The app is multi-user and gated behind a login. The seeded demo
account owns the 8 sample tastes:

- **Email:** `demo@yummy.test` · `demo1234`
- **Phone:** `+8613800138000` — request a code; in dev the 6-digit code is shown
  on the login screen and logged to the server console (no SMS gateway needed).

New phone numbers / emails create fresh, **isolated** accounts. Social logins
(WeChat · Google · Apple) appear once their credentials are set in `.env`
(see `.env.example`).

## What works

- **Accounts & sign-in** — phone + SMS code (domestic) or email + password
  (international), with WeChat/Google/Apple social login when configured. Every
  taste is owned by a user and isolated server-side; sessions are httpOnly
  cookies backed by a `sessions` table.
- **Library** — browse your tastes, search by name/place, filter by tag.
- **Recall** — "tasted it before?" search → shows the verdict on file, or a
  "no record — log it now" empty state.
- **Add a taste** — name / place / price / verdict / tags / note, with optional
  **photo upload** (saved under `public/uploads/`). Persists to Postgres.
- **Detail** — full record with the slapped-on verdict stamp; delete a taste.
- **Stats** — YUM/MEH/NAH counts, verdict breakdown bars, and **money saved**
  (sum of NAH prices — what you avoided re-buying).
- **i18n** — prominent language switcher; choice persists in `localStorage`;
  pixel-CJK fonts per locale.

## Layout

```
src/
  app/
    layout.tsx              # root layout, wraps <I18nProvider>, imports globals
    page.tsx                # mounts the responsive AppShell
    globals.css             # imports the DS tokens/base/component CSS
    api/
      tastes/route.ts       # GET (search/filter) · POST (JSON or multipart photo)
      tastes/[id]/route.ts  # GET · PATCH · DELETE
      stats/route.ts        # GET aggregate stats
      auth/                 # login · register · otp/{request,verify} · me · logout · oauth/[provider]
  components/
    ds/                     # design-system components (Button, FoodCard, VerdictStamp, …)
    app/                    # app surfaces (AppGate, AuthScreen, AppShell, LibraryView, …)
  lib/
    types.ts                # shared types + API contract (incl. User/auth shapes)
    db.ts                   # pg pool + query helpers (user-scoped tastes, users, sessions, otp)
    auth.ts                 # scrypt hashing, OTP codes, session cookies (server only)
    oauth.ts                # WeChat/Google/Apple provider registry (env-driven)
    auth-context.tsx        # client session context (useAuth)
    api-client.ts           # typed fetch wrappers for the UI
    i18n/                   # runtime, I18nProvider, locales/{zh,en,ko,ja,es}.ts
  styles/ds/                # design-system CSS (tokens, base, components)
db/
  schema.sql · seed.sql     # database schema + sample data
scripts/db-setup.mjs        # runs schema then seed
public/ds-icons/            # 53 pixel-art icons · public/assets/ logos
```

The original design handoff lives in `.design-bundle/` (gitignored) for reference.
