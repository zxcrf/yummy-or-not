# Changelog

All notable changes to **Yummy or Not** are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
this project aims to follow [Semantic Versioning](https://semver.org/).

Issue IDs (e.g. `B1`, `M2`, `m5`) reference the user-perspective QA audit
performed with Chrome DevTools on 2026-06-06.

---

## [Unreleased]

### Added — Multi-user accounts, auth & per-user isolation

Yummy or Not is no longer a single shared log: every taste now belongs to a
user, and the app is gated behind sign-in. Two onboarding habits are supported
side by side so it fits both markets:

- **Domestic (China):** phone number + SMS one-time code, plus **WeChat** social
  login. Accounts are created on first successful code entry.
- **International:** email + password sign-up/sign-in, plus **Google** and
  **Apple** social login.

Highlights:

- **Per-user isolation.** `tastes` gained a `user_id` FK; every query
  (`list/get/create/update/delete/stats`) is scoped to the signed-in user, and
  all `/api/tastes*` + `/api/stats` routes return `401` without a session.
  Verified end-to-end: a fresh user sees an empty library; one user's tastes are
  invisible to another.
- **Sessions.** Opaque server-side tokens in a `sessions` table, carried in an
  httpOnly `yon_session` cookie, so logout / revocation is real. Passwords are
  hashed with scrypt and OTP codes are stored only as sha256 — **no new runtime
  dependencies** (Node `crypto` only).
- **Pluggable delivery.** SMS goes through `SMS_WEBHOOK_URL` (Aliyun/Tencent/
  Twilio); outside production the code is returned as `devCode` and logged so the
  flow is testable with no gateway. Social providers light up automatically once
  their `*_CLIENT_ID` / `*_CLIENT_SECRET` (or `WECHAT_APP_ID`/`_SECRET`) env
  vars are present; otherwise their buttons render disabled.
- **UI.** New `AuthScreen` (phone / email tabs + social buttons + language
  switcher) behind an `AppGate`; the sidebar and **You** screen now show the real
  account and a sign-out action. New auth strings localized across all 5 locales.
- **Schema & seed.** New `users`, `auth_identities`, `sessions`, `otp_codes`
  tables; the 8 sample tastes are now owned by a demo account
  (`demo@yummy.test` / `demo1234`, or phone `+8613800138000` via dev OTP).

_New files:_ `src/lib/auth.ts`, `src/lib/oauth.ts`, `src/lib/auth-context.tsx`,
`src/components/app/AuthScreen.tsx`, `src/components/app/AppGate.tsx`,
`src/app/api/auth/**`. _Touched:_ `db/{schema,seed}.sql`, `src/lib/{db,types,
api-client}.ts`, the `tastes`/`stats` routes, `AppShell`, `YouView`, `layout`,
`page`, all `i18n/locales/*`, `.env.example`.

---

## [0.1.1] — 2026-06-06

QA pass on the initial build, then a parallel fix round. A Chrome-DevTools
user-perspective audit found 10 issues (1 blocker, 3 major, 6 minor); all were
fixed and re-verified in a second audit (9 FIXED + 1 fixed-on-followup), with a
regression sweep across 5 languages and both layouts.

### Fixed

- **[B1 · Blocker] Desktop "Log a taste" button opened nothing.**
  Two equal-specificity rules for `.yon-desktop-add-modal` in `src/app/app.css`
  conflicted — a later unconditional `display:none` overrode the `≥900px`
  `display:block`, so the add modal was permanently hidden on desktop (core
  feature unusable). Scoped the hide rule to `@media (max-width:899px)`.
  _File:_ `src/app/app.css`.
- **[M1 · Major] Logo 404 / broken image on every page.**
  `AppShell` referenced `/logo-mark.svg` but the asset lives at
  `/assets/logo-mark.svg`. Corrected both `<img>` sources.
  _File:_ `src/components/app/AppShell.tsx`.
- **[M2 · Major] Tags double-JSON-encoded on photo uploads.**
  The API client sent `tags` as `JSON.stringify(array)` in one multipart field,
  while the route parsed it as comma-separated → a tag stored as the literal
  `["Dessert"]`. Now each tag is sent as its own field and read with
  `formData.getAll('tags')`; `db.rowToTaste` defensively flattens any legacy
  double-encoded tag, and `FoodCard` sanitizes tag rendering as a UI safety net.
  _Files:_ `src/lib/api-client.ts`, `src/app/api/tastes/route.ts`,
  `src/lib/db.ts`, `src/components/ds/FoodCard.tsx`.
- **[M3 · Major] Mobile bottom nav showed two "Stats" tabs; no profile page.**
  The 4th tab duplicated `stats`. Added a distinct `you` view and a new
  **YouView** profile screen (avatar, verdict tiles, money-saved, settings),
  reachable via the mobile "我的/You" tab; removed the now-redundant profile
  header from StatsView and gave the stats screen a visible title on mobile.
  _Files:_ `src/components/app/AppShell.tsx`, `src/components/app/YouView.tsx`
  (new), `src/components/app/StatsView.tsx`.
- **[m1 · Minor] Delete confirmation showed the wrong text** (it reused the
  "warn me before I buy again" label). Added a dedicated `confirm_delete` string
  to all 5 locales and used it in the delete handler.
  _Files:_ `src/components/app/DetailView.tsx`, `src/lib/i18n/locales/*.ts`.
- **[m2 · Minor] Price was stored/displayed unnormalized** (e.g. `19`). Prices
  are now normalized to a currency string (`$19.00`) on write, preserving
  non-numeric input (e.g. `—`).
  _File:_ `src/lib/db.ts`.
- **[m3 · Minor] Korean copy fixes.** `글써 → 글쎄` (MEH, 3 places),
  `그저 그러도다요 → 그저 그래요` (so-so), `어느나요? → 어땠나요?` (how-was-it).
  _File:_ `src/lib/i18n/locales/ko.ts`.
- **[m4 · Minor] Chinese copy fixes.** Traditional `錢 → 钱` in the recall
  subtitle; nonsense placeholder `抒茶 → 拿铁`.
  _File:_ `src/lib/i18n/locales/zh.ts`.
- **[m5 · Minor] React "unknown `createdAt` prop on a DOM element" error.**
  `FoodCard` spread the whole `Taste` object onto its root `<div>`; it now only
  forwards known, DOM-safe props. Removes the console error + error badge.
  _File:_ `src/components/ds/FoodCard.tsx`.
- **[m6 · Minor] Search inputs lacked a form-field identifier**, then the first
  fix introduced duplicate `id`s (each view mounts in both the desktop and
  mobile shells). Final fix: keep `name="search"` + `aria-label` and drop `id`
  (uniqueness no longer required), eliminating the duplicate-id warning.
  _Files:_ `src/components/app/LibraryView.tsx`, `src/components/app/RecallView.tsx`.
- **[es copy] Spanish stats subtitle leaked the English word "nah"** →
  rewritten as natural Spanish.
  _File:_ `src/lib/i18n/locales/es.ts`.

### Known issues

- **[INFO] Stats "saved" amount flashes `$0.00` for one frame** before the
  async fetch resolves. Cosmetic; not reliably reproducible. Candidate for a
  loading placeholder.
- Detail-screen **Edit** button and the **"warn me before I buy again"** toggle
  are visual-only (no persistence) — carried over from the prototype.
- `npm install` reports 2 dependency advisories (1 critical) — run `npm audit`
  before any deploy.

---

## [0.1.0] — 2026-06-06

Initial implementation of the **Yummy or Not** product from the Claude Design
handoff bundle (`yummy-or-not-design-system`). Built by a 3-agent team after a
shared scaffold + type contract were laid down.

### Added

- **Stack & scaffold** — Next.js 15 (App Router) · React 19 · TypeScript ·
  PostgreSQL. Shared API/type contract in `src/lib/types.ts`. DS tokens/base/
  component CSS imported via `src/app/globals.css`.
- **Design system** — 14 components ported JSX→TSX (`Button`, `IconButton`,
  `Icon`, `Input`, `Textarea`, `Switch`, `Card`, `Badge`, `Tag`, `Avatar`,
  `VerdictStamp`, `VerdictPicker`, `FoodCard`, `LangSwitcher`) + 53 recolorable
  pixel icons + logos.
- **Responsive app** — one UI serving the desktop sidebar dashboard and the
  mobile top-bar + bottom-tab + FAB layout (breakpoint 900px). Views: Library,
  Recall, Stats, Add, Detail.
- **Backend** — `tastes` table + seed (8 sample tastes), `pg` client, REST API:
  `GET/POST /api/tastes`, `GET/PATCH/DELETE /api/tastes/[id]`, `GET /api/stats`.
  Photo upload to `public/uploads/`.
- **Internationalization** — runtime + `I18nProvider`; 5 locales (中文 default,
  English, 한국어, 日本語, Español) including localized verdict words; choice
  persists in `localStorage`; pixel-CJK fonts per locale.
- **Money-saved metric** — Stats sums the prices of `NAH` tastes (what re-buying
  was avoided).

### Verified

- `tsc --noEmit` clean · `next build` passes · `npm run db:setup` seeds 8 rows ·
  API CRUD exercised end-to-end against Postgres (create/search/patch/delete +
  stats recompute) · SSR renders with 中文 default and no console errors.

---

## Conventions

- **Setup / run:** see [README.md](./README.md).
- **Verdicts** are sacred and always three: `YUM` / `MEH` / `NAH`.
- **Unreleased work** accrues under an `## [Unreleased]` heading until cut into a
  dated, versioned release.
- The original design handoff is kept at `.design-bundle/` (gitignored) for
  reference.
