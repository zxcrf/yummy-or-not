import { defineConfig, devices } from '@playwright/test'

const apiPort = Number(process.env.E2E_API_PORT ?? 3100)
const webPort = Number(process.env.E2E_WEB_PORT ?? 19006)
const apiURL = process.env.E2E_API_URL ?? `http://127.0.0.1:${apiPort}`
const webURL = process.env.E2E_WEB_URL ?? `http://localhost:${webPort}`

process.env.E2E_API_URL = apiURL
process.env.E2E_WEB_URL = webURL

function envWith(overrides: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries({ ...process.env, ...overrides }).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  )
}

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: {
    timeout: 15_000,
  },
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: webURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: [
    {
      command: `pnpm --filter @yon/api exec next dev --hostname 127.0.0.1 --port ${apiPort}`,
      url: `${apiURL}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: envWith({
        PORT: String(apiPort),
        ALLOWED_ORIGIN: webURL,
        APP_WEB_URL: webURL,
        NEXT_TELEMETRY_DISABLED: '1',
      }),
    },
    {
      command: `pnpm --filter @yon/mobile exec expo start --web --localhost --port ${webPort}`,
      url: webURL,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      env: envWith({
        CI: '1',
        BROWSER: 'none',
        EXPO_NO_TELEMETRY: '1',
        EXPO_PUBLIC_API_URL: apiURL,
      }),
    },
  ],
  projects: [
    {
      name: 'mobile-chromium',
      use: {
        ...devices['Pixel 5'],
      },
    },
  ],
})
