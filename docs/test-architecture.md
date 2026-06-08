# Yummy or Not — Test Architecture

> Established for GitHub Issue #12: "Establish user testing and multi-platform E2E management"

## 1. Test Pyramid / Layer Strategy

```
                    ┌─────────────┐
                    │  E2E (few)  │  Playwright (web), Maestro (mobile)
                    │  ~5-10 flows│  High-value user journeys only
                    ├─────────────┤
                  │  Integration  │  API route handlers against real Postgres
                  │  ~20-30 tests │  Auth, CRUD, permissions, error states
                  ├───────────────┤
                │  Contract Tests   │  @yon/shared types ↔ API responses
                │  ~10-15 tests     │  Schema shape validation
                ├───────────────────┤
              │  Unit / Component     │  Jest (mobile), Jest (api, shared)
              │  ~50+ tests           │  Pure logic, DS components, regressions
              └───────────────────────┘
```

### What goes where (concrete examples from this codebase)

| Layer | What belongs here | Example |
|-------|------------------|---------|
| **Unit** | Pure functions, helpers, isolated component rendering | `hashPassword`/`verifyPassword` (`apps/api/src/lib/auth.ts:26-40`), `normalizePrice`/`relativeDate` (`apps/api/src/lib/db.ts:29-46,86-99`), `resolvePhotoUrl` (`apps/api/src/lib/db.ts:53-65`) |
| **Component** | React component behavior under mock APIs | PhotoPreview `<Image>` vs `<img>` (`apps/mobile/components/app/__tests__/PhotoPreview.test.tsx`), PullToRefresh re-fetch (`apps/mobile/components/app/__tests__/PullToRefresh.test.tsx`), Input Android color (`apps/mobile/components/ds/__tests__/Input.test.tsx`) |
| **Integration** | API route handler → real DB round-trip | POST `/api/auth/register` with valid/invalid/duplicate email, GET `/api/tastes` with `q` and `filter` params, DELETE `/api/tastes/[id]` cascade + photo cleanup |
| **Contract** | API response shapes match `@yon/shared` types | GET `/api/tastes` response conforms to `Taste[]` shape (`packages/shared/src/types.ts:13-29`), auth endpoints return `AuthResponse` shape (`packages/shared/src/types.ts:111-115`) |
| **E2E (web)** | Playwright: real browser against real API | Login with demo account → see library → add a taste → verify it appears |
| **E2E (mobile)** | Maestro: real device/emulator flows | Login smoke → library screen renders → add button works |


## 2. Directory Structure

```
apps/
  api/
    src/lib/__tests__/              # Unit tests for auth.ts, db.ts helpers
      auth.test.ts                  # hashPassword, verifyPassword, normalizePhone, etc.
      db-helpers.test.ts            # relativeDate, resolvePhotoUrl, normalizePrice
    src/app/api/__tests__/          # Integration tests for route handlers
      auth-register.test.ts         # POST /api/auth/register
      auth-login.test.ts            # POST /api/auth/login
      auth-otp.test.ts              # OTP request/verify flow
      tastes-crud.test.ts           # GET/POST/PATCH/DELETE /api/tastes
      tastes-query.test.ts          # Search (q) and filter params
      stats.test.ts                 # GET /api/stats aggregation
      health.test.ts                # GET /api/health
    jest.config.ts                  # Node-env Jest config
    test/                           # Test infrastructure
      setup.ts                      # Global setup: DATABASE_URL, pool init
      helpers.ts                    # createTestUser, authenticatedFetch, cleanup
      global-setup.ts               # Run schema.sql against test DB
      global-teardown.ts            # Drop test DB / close pool
  mobile/
    components/app/__tests__/       # (existing) Component regression tests
    components/ds/__tests__/        # (existing) DS component tests
    jest.config.js                  # (existing) jest-expo config
packages/
  shared/
    src/__tests__/                  # Contract and unit tests
      types-contract.test.ts        # API response shape validation
      api-client.test.ts            # Client function unit tests (mocked fetch)
    jest.config.ts                  # Node-env Jest config
e2e/
  web/
    playwright.config.ts
    fixtures/
      auth.ts                       # Authenticated page fixture
      test-user.ts                  # Ephemeral user lifecycle
    tests/
      login.spec.ts                 # Web login smoke
      add-taste.spec.ts             # Add a taste flow
      cross-platform.spec.ts        # Create via API, verify via web UI
    .env.test                       # Test API URL
  mobile/
    maestro/
      login-smoke.yaml              # Mobile login flow
      add-taste.yaml                # Mobile add-taste flow
    README.md                       # Setup instructions for Maestro
```


## 3. Test Data Strategy

### Per-user isolation (no "tenant" table — user IS the isolation boundary)

Every data query in the API is scoped by `user_id` (`apps/api/src/lib/db.ts:121-263`). All child tables cascade on user delete (`apps/api/db/schema.sql:29,33,47,62`). This means:

**Isolation primitive:** Each test creates an ephemeral user via `POST /api/auth/register`, receives a `{user, token}`, runs its operations scoped to that user, then deletes the user at cleanup.

```typescript
// e2e/web/fixtures/test-user.ts
export async function createTestUser(apiUrl: string) {
  const email = `test-${crypto.randomUUID()}@test.local`;
  const res = await fetch(`${apiUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'test123456', displayName: 'E2E User' }),
  });
  const { user, token } = await res.json();
  return { user, token, email, cleanup: () => deleteTestUser(user.id) };
}
```

**Cleanup:** `DELETE FROM users WHERE id = $1` cascades to `sessions`, `auth_identities`, `otp_codes`, and `tastes`. For integration tests, expose this via a direct DB call. For E2E, use a cleanup API endpoint (test-only, gated by environment).

### Seed data strategy

| Context | Approach |
|---------|----------|
| **Local dev** | `pnpm --filter @yon/api db:setup` runs `schema.sql` + `seed.sql` (`apps/api/scripts/db-setup.mjs`). Demo user `demo@yummy.test` / `demo1234` with 8 sample tastes. |
| **CI integration tests** | Postgres service container. `global-setup.ts` runs `schema.sql` (no seed — each test creates its own user). |
| **CI E2E (web)** | Same Postgres service container. `seed.sql` for demo user smoke. Ephemeral users for mutation tests. |
| **Nightly E2E** | Neon branch (production schema parity). Seed + ephemeral users. |

### Decision: Postgres service container (PR) vs Neon branch (nightly)

| | Service container | Neon branch |
|---|---|---|
| **Speed** | ~2s to start, local network | ~10-15s branch creation, network latency |
| **Hermetic** | Fully isolated, disposable | Shared Neon infra, branch cleanup needed |
| **Prod parity** | Standard Postgres 16 | Neon (same Postgres, plus Neon extensions) |
| **Cost** | Free (GHA runner) | Free tier has branch limits |

**Recommendation:** Service container for every PR (fast, hermetic). Neon branch for weekly/nightly full E2E against production-like data and network conditions.

### Critical rule: Never mutate `demo-user`

The seed row `demo-user` (`apps/api/db/seed.sql:8`) is shared across dev environments. Tests must never modify it. Always create ephemeral users.


## 4. Tooling Choices

### API unit + integration tests: Jest (Node)

**Why Jest over Vitest:** The monorepo already uses Jest for mobile (`apps/mobile/jest.config.js`). Adding Vitest would mean two test runners, two configs, two sets of developer knowledge. Jest's Node environment is sufficient for testing API route handlers and pure functions. The `turbo.json` test task is already wired.

**Route handler testing approach:** Import the exported `GET`/`POST`/`PATCH`/`DELETE` functions directly from route files and invoke them with constructed `NextRequest` objects. This tests the full handler logic (validation, auth, DB operations) without HTTP overhead.

```typescript
// Example: testing apps/api/src/app/api/auth/register/route.ts
import { POST } from '@/app/api/auth/register/route';

const req = new NextRequest('http://localhost/api/auth/register', {
  method: 'POST',
  body: JSON.stringify({ email: 'new@test.local', password: 'test123456' }),
  headers: { 'Content-Type': 'application/json' },
});
const res = await POST(req);
expect(res.status).toBe(200);
const body = await res.json();
expect(body).toHaveProperty('user.id');
expect(body).toHaveProperty('token');
```

**Setup requirement (`apps/api/src/lib/db.ts:15-24`):** The `Pool` is constructed at module load from `process.env.DATABASE_URL`. The jest `globalSetup` must set this env var before any test file imports a handler.

### Web E2E: Playwright

**Why Playwright:**
- The web app is served at `/web/` as a React Native Web SPA embedded in the Next.js API host (`apps/api/next.config.mjs:24-33`). Playwright can test the full web experience including the API layer.
- Native browser automation (no WebDriver protocol overhead).
- Built-in trace viewer, screenshot, video capture for failure diagnostics.
- Auth state can be persisted as `storageState` for fast test setup.

**Target:** `next build && next start` (production-like), serving both the API and the embedded web SPA on one port. This tests the actual deployed configuration.

### Mobile E2E: Maestro (Detox deferred)

**Why Maestro first:**
- YAML-based flows are writable without deep native toolchain knowledge.
- Works with real APK on device/emulator — no special test build needed.
- Explicit project preference: "优先 Maestro；React Native 深度场景后续再评估 Detox."

**Critical constraint:** `EXPO_PUBLIC_API_URL` is baked into the APK at build time (`packages/shared/src/api-client.ts:40`). A production APK permanently targets the production API. To run Maestro against a test API:
- Option A: Dedicated EAS build profile `e2e` with `EXPO_PUBLIC_API_URL` pointing to the test API.
- Option B: Run Maestro against the production API with a dedicated test user (acceptable for smoke, not for mutation tests).

**Recommendation:** Start with Option B (smoke tests against prod with a dedicated test user). Add Option A for nightly mutation tests when the team is ready to maintain a separate build profile.

### Contract tests: Jest in `packages/shared`

Test that the type definitions in `packages/shared/src/types.ts` are consistent with actual API responses. Uses mocked fetch to validate response shapes, plus runtime shape assertions.


## 5. CI Pipeline Design

### Current state: No test job exists

`docker-api.yml` builds on main push (path-filtered). `eas-release.yml` builds on tag push. Neither runs tests.

### New workflow: `.github/workflows/test.yml` (PR-level)

```yaml
name: Test
on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_USER: test
          POSTGRES_PASSWORD: test
          POSTGRES_DB: yon_test
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    env:
      DATABASE_URL: postgresql://test:test@localhost:5432/yon_test

    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
          cache-dependency-path: pnpm-lock.yaml

      - run: pnpm install --frozen-lockfile

      # Initialize the test database
      - run: pnpm --filter @yon/api db:setup

      # Run all unit + integration tests
      - run: pnpm turbo run test

  e2e-web:
    runs-on: ubuntu-latest
    needs: test
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_USER: test
          POSTGRES_PASSWORD: test
          POSTGRES_DB: yon_test
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    env:
      DATABASE_URL: postgresql://test:test@localhost:5432/yon_test

    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
          cache-dependency-path: pnpm-lock.yaml

      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @yon/api db:setup
      - run: pnpm --filter @yon/api build:web
      - run: pnpm --filter @yon/api build

      - name: Install Playwright browsers
        run: npx playwright install --with-deps chromium

      - name: Start API server
        run: pnpm --filter @yon/api start &
        env:
          PORT: 3000

      - name: Wait for server
        run: npx wait-on http://localhost:3000/api/health --timeout 30000

      - name: Run Playwright tests
        run: npx playwright test --project=chromium
        working-directory: e2e/web

      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: e2e/web/playwright-report/
          retention-days: 7

      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-traces
          path: e2e/web/test-results/
          retention-days: 7
```

### Nightly workflow: `.github/workflows/test-nightly.yml` (manual/cron)

- Full Playwright suite (all browsers: chromium, firefox, webkit).
- Maestro mobile flows against production or a Neon branch.
- Longer timeouts, video recording enabled.
- Triggered by `workflow_dispatch` and weekly cron (`0 3 * * 1`).

### Artifact collection

| Artifact | When collected | Retention |
|----------|---------------|-----------|
| Playwright traces | On test failure | 7 days |
| Playwright screenshots | On test failure | 7 days |
| Playwright video | Nightly runs (always) | 3 days |
| Jest coverage report | Every PR | 7 days |
| Maestro screenshots | On test failure | 7 days |
| API server logs | On E2E failure | 3 days |


## 6. Cross-Platform E2E

### Architecture insight: the problem is simpler than it looks

Both web (RN Web at `/web/`) and mobile consume the same `@yon/shared` api-client (`packages/shared/src/api-client.ts`) against the same Postgres DB. "Add on one platform, see on another" reduces to "same user, same DB, two UI shells."

### Pattern A: API-fixture seeded state (recommended, stable)

The issue endorses this: "通过 API fixture 建状态，减少 UI 慢路径和不稳定等待."

```
Test: "Add taste on web, verify via API"
  1. Playwright: login as test user on /web/
  2. Playwright: fill AddModal form, submit
  3. Direct API: GET /api/tastes with test user's token
  4. Assert: new taste appears in the response
```

This avoids the flakiness of two separate UI sessions and still proves the data flows through the API correctly.

### Pattern B: Two-UI cross-platform (nightly aspiration)

```
Test: "Add taste via API, verify on web UI"
  1. Direct API: POST /api/tastes with test user's token
  2. Playwright: login as same user on /web/
  3. Playwright: assert the taste card is visible in the library
```

This proves the web UI correctly reads data created by any client (including mobile).

### Why not "add on Maestro, verify on Playwright"?

Running Maestro and Playwright in the same CI job requires both an Android emulator and a browser. The test becomes slow (~3-5 min), flaky (emulator startup), and hard to debug. The API-fixture pattern achieves the same data-integrity guarantee at a fraction of the cost.


## 7. Auth in Tests

### The OTP bypass already exists

`apps/api/src/app/api/auth/otp/request/route.ts:52-53`:
```typescript
const body: { ok: true; devCode?: string } = { ok: true };
if (process.env.NODE_ENV !== 'production') body.devCode = code;
```

When `NODE_ENV !== 'production'` (the default in test/dev), the OTP code is returned in the response body. Full phone-login flow with zero SMS gateway:

1. POST `/api/auth/otp/request` with `{ phone }` — response includes `devCode`
2. POST `/api/auth/otp/verify` with `{ phone, code: devCode }` — returns `{ user, token }`

**Constraint:** The test API instance must NOT run with `NODE_ENV=production`.

### Email-password login (simpler, preferred for most tests)

POST `/api/auth/register` with `{ email, password, displayName }` returns `{ user, token }` (`apps/api/src/app/api/auth/register/route.ts:19-45`). This is the fastest path to an authenticated test session — no OTP, no cookies, just a bearer token.

### Auth helper for integration tests

```typescript
// apps/api/test/helpers.ts
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function createAuthenticatedUser(): Promise<{
  user: User; token: string; cleanup: () => Promise<void>
}> {
  const email = `test-${Date.now()}@test.local`;
  const req = new NextRequest('http://localhost/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password: 'test123456' }),
    headers: { 'Content-Type': 'application/json' },
  });
  const { POST } = await import('@/app/api/auth/register/route');
  const res = await POST(req);
  const { user, token } = await res.json();
  return {
    user,
    token,
    cleanup: async () => {
      await pool.query('DELETE FROM users WHERE id = $1', [user.id]);
    },
  };
}

export function authenticatedRequest(
  url: string,
  token: string,
  init?: RequestInit,
): NextRequest {
  const headers = new Headers(init?.headers);
  headers.set('Authorization', `Bearer ${token}`);
  return new NextRequest(url, { ...init, headers });
}
```

### Auth fixture for Playwright

```typescript
// e2e/web/fixtures/auth.ts
import { test as base, type Page } from '@playwright/test';

export const test = base.extend<{ authedPage: Page }>({
  authedPage: async ({ page }, use) => {
    // Register ephemeral user via API
    const res = await page.request.post('/api/auth/register', {
      data: {
        email: `pw-${Date.now()}@test.local`,
        password: 'test123456',
        displayName: 'PW Test User',
      },
    });
    const { token } = await res.json();

    // Set the token in localStorage (AuthProvider reads from yon_token on web)
    // See: apps/mobile/providers/AuthProvider.tsx:63-65
    await page.goto('/web/');
    await page.evaluate((t) => localStorage.setItem('yon_token', t), token);
    await page.reload();
    await use(page);
  },
});
```

This works because `apps/mobile/providers/AuthProvider.tsx:63-65` reads the token from `localStorage` on web (`Platform.OS === 'web'` branch).

### OAuth: not tested in CI

OAuth providers (WeChat, Google, Apple) require real credentials and redirect flows. The `/api/auth/me` endpoint (`apps/api/src/app/api/auth/me/route.ts:13-19`) returns `configured: false` for unconfigured providers, and the UI hides those buttons. OAuth E2E belongs in manual QA only.


## 8. Failure Diagnostics

### Playwright (web E2E)

| Signal | Configuration | Location |
|--------|--------------|----------|
| **Trace** | `trace: 'retain-on-failure'` in `playwright.config.ts` | `e2e/web/test-results/` |
| **Screenshot** | `screenshot: 'only-on-failure'` | Embedded in trace |
| **Video** | `video: 'retain-on-failure'` (nightly: `'on'`) | `e2e/web/test-results/` |
| **HTML report** | `reporter: ['html', { open: 'never' }]` | `e2e/web/playwright-report/` |

CI uploads `playwright-report/` and `test-results/` as GitHub Actions artifacts on failure.

### Jest (unit/integration)

| Signal | Configuration |
|--------|--------------|
| **Verbose output** | `--verbose` flag in CI |
| **Failed test diff** | Built-in Jest snapshot diff |
| **Coverage** | `--coverage` with lcov reporter, uploaded as artifact |

### Maestro (mobile E2E)

| Signal | Configuration |
|--------|--------------|
| **Screenshot** | `takeScreenshot` command on failure in YAML |
| **Video** | `--format junit --output` for CI, device recording via `adb` |
| **Logs** | `adb logcat` captured during test run |

### API server logs

For E2E failures, capture the API server's stdout/stderr. In CI, redirect server output to a file and upload on failure:

```yaml
- name: Start API server
  run: pnpm --filter @yon/api start > /tmp/api-server.log 2>&1 &

- uses: actions/upload-artifact@v4
  if: failure()
  with:
    name: api-server-logs
    path: /tmp/api-server.log
    retention-days: 3
```

The `console.error` calls in every route handler (e.g., `apps/api/src/app/api/tastes/route.ts:29,99`) ensure server-side errors are logged.


## 9. Implementation Phases

### Phase 1: API and shared test infrastructure + PR CI (1-2 weeks)

**Goal:** Every PR runs unit and integration tests against a real database.

1. Add `jest.config.ts` and `"test": "jest"` script to `apps/api/package.json` and `packages/shared/package.json`.
2. Create `apps/api/test/setup.ts` (sets `DATABASE_URL` before pool creation), `global-setup.ts` (runs `schema.sql`), `global-teardown.ts` (closes pool).
3. Write API unit tests for pure functions:
   - `apps/api/src/lib/auth.ts`: `hashPassword`/`verifyPassword`, `normalizePhone`/`isValidPhone`, `normalizeEmail`/`isValidEmail`, `generateOtp`/`hashCode`.
   - `apps/api/src/lib/db.ts`: `relativeDate`, `resolvePhotoUrl`, `normalizePrice`, `normalizeTag`.
4. Write API integration tests:
   - Auth: register (valid / invalid email / weak password / duplicate), login (valid / invalid), OTP flow via `devCode`.
   - Tastes CRUD: create (JSON + multipart), list (with `q` and `filter`), get, update (patch fields + `incrementBought`), delete (with photo cleanup mock).
   - Stats: aggregation after creating mixed-verdict tastes.
   - Permissions: all taste/stats endpoints return 401 without token; user A cannot access user B's tastes.
5. Write shared contract tests: `api-client.ts` functions with mocked fetch, response shape validation against `Taste`, `AuthResponse`, `Stats`.
6. Add `.github/workflows/test.yml` with Postgres service container.
7. Verify `pnpm turbo run test` passes for all three packages.

### Phase 2: Web E2E with Playwright (1 week)

**Goal:** PR-level web login smoke; foundation for more flows.

1. Install Playwright in `e2e/web/`.
2. Configure `playwright.config.ts`: base URL from `next start`, Chromium only for PR.
3. Create auth fixture (ephemeral user via API, token injected into `localStorage`).
4. Write first smoke test: navigate to `/web/`, verify login screen renders, register a user, verify library view loads.
5. Write "add a taste" test: authenticated user fills AddModal (`apps/mobile/components/app/AddModal.tsx`) form, submits, verifies taste appears in library.
6. Add `e2e-web` job to `test.yml` (runs after unit/integration pass).
7. Configure failure artifacts: traces, screenshots, HTML report.

### Phase 3: Test data helpers + cross-platform verification (1 week)

**Goal:** Reusable seed/reset helpers; at least one cross-platform test.

1. Create `e2e/web/fixtures/test-user.ts`: ephemeral user creation via `/api/auth/register`, cleanup via direct DB or a test-only delete endpoint.
2. Write cross-platform test: create a taste via direct API call (POST `/api/tastes` with bearer token), then verify it renders in the web library UI via Playwright.
3. Add a reverse direction test: Playwright creates via AddModal UI form, then a direct API GET `/api/tastes` verifies the data shape and content.
4. Document the test-user lifecycle and cleanup contract.

### Phase 4: Maestro mobile PoC (1 week, nightly only)

**Goal:** Prove Maestro works for mobile smoke; not in PR pipeline.

1. Create `e2e/mobile/maestro/login-smoke.yaml`: launch app, verify `AuthScreen` (`apps/mobile/components/app/AuthScreen.tsx`) renders, login with demo credentials.
2. Create `e2e/mobile/maestro/add-taste.yaml`: authenticated, tap add, fill form, verify navigation to detail (`apps/mobile/app/taste/[id].tsx`).
3. Add `.github/workflows/test-nightly.yml` workflow (manual dispatch + weekly cron) with Android emulator + Maestro.
4. Decision point: run against production API (with dedicated test user) or build a dedicated EAS `e2e` profile with test `EXPO_PUBLIC_API_URL`.

### Phase 5: Documentation + guidelines (ongoing)

1. Finalize this document (`docs/test-architecture.md`).
2. Update `CLAUDE.md` with the testing decision tree (section 10).
3. Add test-writing examples to onboarding docs.


## 10. Testing Guidelines — Decision Tree

```
Is this a user-reported bug / crash / behavior complaint?
│
├─ YES ─→ MANDATORY: Write a unit/component test that:
│         1. Reproduces the reported failure (fails against old code)
│         2. Passes against the fix
│         3. Lives in __tests__/ next to the code
│         4. Runs via `pnpm --filter <pkg> test`
│         Templates:
│           - PhotoPreview.test.tsx  (crash: raw <img> on native)
│           - Input.test.tsx         (invisible text: wrong color on Android)
│           - PullToRefresh.test.tsx (stale data: no refresh mechanism)
│
├─ NO ─→ Is this a pure function or helper? (auth, db helpers, price normalization)
│         │
│         ├─ YES ─→ Unit test in __tests__/ next to the module
│         │
│         ├─ NO ─→ Is this an API route change?
│         │         │
│         │         ├─ YES ─→ Integration test against real Postgres
│         │         │         (auth, status codes, permissions, edge cases)
│         │         │
│         │         ├─ NO ─→ Is this a UI component change?
│         │         │         │
│         │         │         ├─ YES ─→ Component test if behavior-meaningful
│         │         │         │         (renders correct element, passes correct props)
│         │         │         │         Skip if purely visual (CSS/spacing/color)
│         │         │         │
│         │         │         ├─ NO ─→ Is this a cross-cutting user journey?
│         │         │         │         (login → add → verify on other platform)
│         │         │         │
│         │         │         │         ├─ YES ─→ E2E test (Playwright web)
│         │         │         │         │         Only for high-value paths
│         │         │         │         │
│         │         │         │         └─ NO ─→ No test needed
│         │         │         │                   (config, docs, CI changes)
```

### What NOT to test with E2E

Per the issue's non-goals:
- Individual button clicks or pure style changes.
- Every permutation of form validation (that is integration test territory).
- Real SMS/email/push delivery.
- Full device/browser matrix on every PR (nightly only).
- Deterministic test routing, retries, or status-code logic via LLM.

### "Mobile login smoke at PR" — what it concretely means

The issue lists mobile login smoke as a PR success criterion. But real device E2E (Maestro on an emulator) adds ~3-5 minutes and flakiness risk to every PR.

**Resolution:** At PR level, "mobile login smoke" is satisfied by Jest component tests running under `jest-expo` (which simulates React Native rendering). The `AuthScreen` component's login flow (form → API call → `AuthProvider.refresh()`) is testable as a component test with mocked API. Maestro device flows run nightly.

| PR level | Nightly |
|----------|---------|
| Jest component: AuthScreen renders, form submits, error states | Maestro: real APK, real auth screen, real keyboard input |
| Jest component: AppGate shows auth screen when signed out | Maestro: full login → library → add taste journey |
| API integration: register/login/OTP return correct tokens | Full Playwright suite, all browsers |


## Trade-offs Summary

| Decision | Chosen | Alternative | Why chosen | Cost of choice |
|----------|--------|-------------|-----------|----------------|
| API test runner | Jest (Node) | Vitest | Consistency with mobile's Jest; turbo `test` task works uniformly | Slower than Vitest; no native ESM support |
| PR-level mobile smoke | Jest component tests | Maestro on emulator | Fast (~5s vs ~180s), no emulator flakiness | Less realistic than real device; misses native rendering bugs |
| Cross-platform E2E | API-fixture seeded state | Two real UI sessions | Stable, fast, debuggable; same data integrity proof | Does not test the second UI's rendering of the data |
| PR database | Postgres service container | Neon branch | Fast, free, hermetic | Not byte-identical to production Neon |
| Web E2E target | `next start` (production build) | `expo start --web` (dev server) | Tests the real deployed configuration | Requires full build (~30-60s), slower iteration |
| Maestro timeline | Phase 4, nightly only | Phase 2, PR level | Avoids emulator overhead on every PR; team has no Maestro experience yet | Mobile E2E gaps until Phase 4 |


## Key References

| File | What it tells us |
|------|-----------------|
| `apps/api/db/schema.sql:12-78` | Full DB schema; CASCADE relationships enable per-user cleanup |
| `apps/api/db/seed.sql:8-11` | Demo user: `demo@yummy.test` / `demo1234` |
| `apps/api/src/lib/auth.ts:26-57` | Pure functions to unit test (hash, verify, OTP) |
| `apps/api/src/lib/auth.ts:111-117` | `tokenFromRequest` — bearer extraction logic |
| `apps/api/src/lib/db.ts:15-24` | Pool init at import time — test setup constraint |
| `apps/api/src/lib/db.ts:29-117` | Pure helpers to unit test (relativeDate, resolvePhotoUrl, etc.) |
| `apps/api/src/lib/db.ts:122-292` | All queries scoped by userId — isolation basis |
| `apps/api/src/app/api/auth/register/route.ts:19-45` | Register returns token — test user creation path |
| `apps/api/src/app/api/auth/otp/request/route.ts:52-53` | `devCode` bypass — zero-SMS test auth |
| `apps/api/src/app/api/tastes/route.ts` | Tastes CRUD — primary integration test target |
| `apps/api/next.config.mjs:24-33` | Web SPA embedding — Playwright target config |
| `apps/mobile/jest.config.js` | Existing jest-expo config — template for new packages |
| `apps/mobile/providers/AuthProvider.tsx:63-65` | Web reads token from localStorage — Playwright auth basis |
| `apps/mobile/components/app/__tests__/` | Existing regression tests — templates for new tests |
| `packages/shared/src/types.ts:13-29,111-115` | Contract types (Taste, AuthResponse) |
| `packages/shared/src/api-client.ts:40` | `EXPO_PUBLIC_API_URL` baked at build — mobile E2E constraint |
| `turbo.json:23-25` | Test task already defined, wiring exists |
