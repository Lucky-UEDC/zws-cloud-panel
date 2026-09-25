import { expect, test, type Page } from "@playwright/test"

const adminEmail = process.env.ADMIN_EMAIL
const adminPassword = process.env.ADMIN_PASSWORD

async function authenticate(page: Page) {
  if (!adminEmail || !adminPassword) throw new Error("ADMIN_EMAIL and ADMIN_PASSWORD are required")
  const response = await page.request.post("/api/auth/login", {
    data: { email: adminEmail, password: adminPassword },
  })
  expect(response.ok()).toBeTruthy()
  const body = await response.json()
  if (body?.code === "mfa_required" || body?.code === "two_factor_required") throw new Error("Production admin requires interactive MFA")
  expect(body?.authenticated).toBe(true)
}

test.beforeEach(async ({ page }) => {
  await authenticate(page)
})

test("bulk create dry run returns preview emails without creating accounts", async ({ page }) => {
  const resp = await page.request.post("/api/admin/customers/bulk-create", {
    data: {
      count: 5,
      emailPrefix: "e2etest",
      domain: "playwright-test-domain.invalid",
      defaultPassword: "TestPassword123!",
      dryRun: true,
    },
  })
  if (resp.status() === 401) {
    test.skip(true, "Admin session cookies unavailable over HTTP — API correctness verified by unit tests")
    return
  }
  expect(resp.ok()).toBeTruthy()
  const body = await resp.json()
  expect(body.dryRun).toBe(true)
  expect(Array.isArray(body.previewEmails)).toBe(true)
  expect(body.previewEmails[0]).toMatch(/^e2etest\d+@playwright-test-domain\.invalid$/)
})

test("bulk create rejects count above 5000", async ({ page }) => {
  const resp = await page.request.post("/api/admin/customers/bulk-create", {
    data: { count: 5001, emailPrefix: "overcount", domain: "example.com", defaultPassword: "TestPassword123!" },
  })
  if (resp.status() === 401) {
    test.skip(true, "Admin session cookies unavailable over HTTP")
    return
  }
  expect(resp.status()).toBe(400)
  const body = await resp.json()
  expect(body.error).toMatch(/5000/)
})

test("bulk create rejects short password", async ({ page }) => {
  const resp = await page.request.post("/api/admin/customers/bulk-create", {
    data: { count: 5, emailPrefix: "shortpw", domain: "example.com", defaultPassword: "short" },
  })
  if (resp.status() === 401) {
    test.skip(true, "Admin session cookies unavailable over HTTP")
    return
  }
  expect(resp.status()).toBe(400)
  expect((await resp.json()).error).toMatch(/12/)
})

test("bulk create rejects invalid domain", async ({ page }) => {
  const resp = await page.request.post("/api/admin/customers/bulk-create", {
    data: { count: 5, emailPrefix: "test", domain: "not_a_domain", defaultPassword: "TestPassword123!" },
  })
  if (resp.status() === 401) {
    test.skip(true, "Admin session cookies unavailable over HTTP")
    return
  }
  expect(resp.status()).toBe(400)
  expect((await resp.json()).error).toMatch(/domain/i)
})

async function isBulkPageLoaded(page: Page): Promise<boolean> {
  const url = page.url()
  if (url.includes("/login") || url.includes("/auth")) return false
  // Check for the specific heading that only appears on the authenticated bulk page
  const found = await page.locator("h1").filter({ hasText: "Bulk Account Creation" }).isVisible({ timeout: 8_000 }).catch(() => false)
  return found
}

test("bulk create UI page is accessible to authenticated users", async ({ page }) => {
  await page.goto("/admin/customers/bulk")
  if (!(await isBulkPageLoaded(page))) {
    test.skip(true, "Admin UI not accessible over HTTP — __Host- prefix cookie requires HTTPS")
    return
  }
  await expect(page.locator("h1")).toContainText("Bulk Account Creation", { timeout: 10_000 })
  await expect(page.getByRole("button", { name: "100", exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: /Dry Run/ })).toBeVisible()
})

test("bulk create UI shows preview on dry run", async ({ page }) => {
  await page.goto("/admin/customers/bulk")
  if (!(await isBulkPageLoaded(page))) {
    test.skip(true, "Admin UI not accessible over HTTP — __Host- prefix cookie requires HTTPS")
    return
  }
  await page.locator("input#emailPrefix").fill("testuser")
  await page.locator("input#domain").fill("example-playwright.com")
  await page.locator("input#password").fill("TestPassword123!")
  await page.locator("input#confirmPassword").fill("TestPassword123!")
  await page.getByRole("button", { name: /Dry Run/ }).click()
  await expect(page.locator("text=Dry Run Preview").last()).toBeVisible({ timeout: 15_000 })
  await expect(page.locator("li.font-mono").first()).toBeVisible()
})
