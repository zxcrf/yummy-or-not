import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

type Taste = {
  id: string
  name: string
  place: string
  price: string
  verdict: 'yum' | 'meh' | 'nah'
  tags: string[]
  notes: string
  image: string
}

const API_URL = process.env.E2E_API_URL ?? 'http://127.0.0.1:3100'
const DEMO_EMAIL = process.env.E2E_DEMO_EMAIL ?? 'demo@yummy.test'
const DEMO_PASSWORD = process.env.E2E_DEMO_PASSWORD ?? 'demo1234'
const TASTE_ID = 'matcha'

async function apiLogin(request: APIRequestContext): Promise<string> {
  const response = await request.post(`${API_URL}/api/auth/login`, {
    data: { email: DEMO_EMAIL, password: DEMO_PASSWORD },
  })
  const body = await response.text()
  expect(
    response.ok(),
    `Demo login failed with ${response.status()}: ${body}\nRun a local API database setup first, for example:\nDATABASE_URL=postgresql://root@127.0.0.1:5432/yon_e2e pnpm --filter @yon/api db:setup`,
  ).toBeTruthy()
  return JSON.parse(body).token as string
}

async function getTaste(request: APIRequestContext, token: string): Promise<Taste> {
  const response = await request.get(`${API_URL}/api/tastes/${TASTE_ID}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const body = await response.text()
  expect(
    response.ok(),
    `Seed taste "${TASTE_ID}" was not available: ${response.status()} ${body}`,
  ).toBeTruthy()
  return JSON.parse(body) as Taste
}

async function restoreTaste(
  request: APIRequestContext,
  token: string,
  original: Taste,
): Promise<void> {
  await request.patch(`${API_URL}/api/tastes/${TASTE_ID}`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      name: original.name,
      place: original.place,
      price: original.price,
      verdict: original.verdict,
      tags: original.tags,
      notes: original.notes,
      image: original.image,
    },
  })
}

async function signInThroughUI(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByText('邮箱', { exact: true }).click()
  await page.getByPlaceholder('you@example.com').fill(DEMO_EMAIL)
  await page.getByPlaceholder('至少 6 位').fill(DEMO_PASSWORD)
  await page.getByRole('button', { name: '登录' }).click()
  await expect(page.getByText('你的口味')).toBeVisible()
}

test('taste detail can be edited and the saved change survives a reload', async ({
  page,
  request,
}) => {
  const token = await apiLogin(request)
  const original = await getTaste(request, token)
  const updatedName = `E2E edited matcha ${Date.now()}`

  try {
    await signInThroughUI(page)

    await page.goto(`/taste/${TASTE_ID}`)
    await expect(page.getByText(original.name)).toBeVisible()

    await page.getByRole('button', { name: '编辑' }).click()
    await page.getByPlaceholder('Brown sugar boba').fill(updatedName)
    await page.getByPlaceholder('Tiger Sugar · Hongdae').fill(original.place)
    await page.getByPlaceholder('$5.80').fill(original.price)
    await page
      .getByPlaceholder('Too sweet, but the texture was perfect...')
      .fill('Edited by Expo Web + Playwright e2e.')
    await page.getByRole('button', { name: '保存' }).click()

    await expect(page.getByText(updatedName)).toBeVisible()
    await expect(page.getByPlaceholder('Brown sugar boba')).toBeHidden()

    await page.reload()
    await expect(page.getByText(updatedName)).toBeVisible()

    const persisted = await getTaste(request, token)
    expect(persisted.name).toBe(updatedName)
    expect(persisted.notes).toBe('Edited by Expo Web + Playwright e2e.')
  } finally {
    await restoreTaste(request, token, original)
  }
})
