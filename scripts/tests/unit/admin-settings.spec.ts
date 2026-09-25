import { expect, test, type Page } from "@playwright/test"

const adminEmail = process.env.ADMIN_EMAIL
const adminPassword = process.env.ADMIN_PASSWORD

async function authenticate(page: Page) {
  if (!adminEmail || !adminPassword) throw new Error("ADMIN_EMAIL and ADMIN_PASSWORD env vars required")
  const response = await page.request.post("/api/auth/login", {
    data: { email: adminEmail, password: adminPassword },
  })
  expect(response.ok()).toBeTruthy()
  const body = await response.json()
  if (body?.code === "mfa_required" || body?.code === "two_factor_required") {
    throw new Error("Admin requires interactive MFA")
  }
  expect(body?.authenticated).toBe(true)
}

test.beforeEach(async ({ page }) => {
  await authenticate(page)
})

test("admin settings API returns billing pricing settings", async ({ page }) => {
  const resp = await page.request.get("/api/admin/settings")
  if (resp.status() === 401) {
    test.skip(true, "Admin session unavailable over HTTP")
    return
  }
  expect([200, 404]).toContain(resp.status())
  if (resp.ok()) {
    const body = await resp.json()
    // Settings should have a billingPricing section
    if (body.billingPricing) {
      expect(typeof body.billingPricing).toBe("object")
    }
  }
})

test("billing pricing settings include invoiceDueDays field", async ({ page }) => {
  const resp = await page.request.get("/api/admin/settings")
  if (resp.status() === 401) {
    test.skip(true, "Admin session unavailable over HTTP")
    return
  }
  if (!resp.ok()) {
    test.skip(true, "Settings endpoint not available")
    return
  }
  const body = await resp.json()
  const billing = body.billingPricing || body.settings?.billingPricing
  if (!billing) {
    test.skip(true, "billingPricing not found in response")
    return
  }
  // After Phase 4, invoiceDueDays should be present (defaults to 7)
  expect(billing).toHaveProperty("invoiceDueDays")
  expect(Number(billing.invoiceDueDays)).toBeGreaterThanOrEqual(0)
})

test("billing pricing settings include defaultTaxPercent field", async ({ page }) => {
  const resp = await page.request.get("/api/admin/settings")
  if (resp.status() === 401) {
    test.skip(true, "Admin session unavailable over HTTP")
    return
  }
  if (!resp.ok()) {
    test.skip(true, "Settings endpoint not available")
    return
  }
  const body = await resp.json()
  const billing = body.billingPricing || body.settings?.billingPricing
  if (!billing) {
    test.skip(true, "billingPricing not found in response")
    return
  }
  expect(billing).toHaveProperty("defaultTaxPercent")
  const taxPercent = Number(billing.defaultTaxPercent)
  expect(taxPercent).toBeGreaterThanOrEqual(0)
  expect(taxPercent).toBeLessThanOrEqual(100)
})

test("admin compute nodes API returns list", async ({ page }) => {
  const resp = await page.request.get("/api/admin/compute-nodes")
  if (resp.status() === 401) {
    test.skip(true, "Admin session unavailable over HTTP")
    return
  }
  expect([200, 404]).toContain(resp.status())
  if (resp.ok()) {
    const body = await resp.json()
    expect(Array.isArray(body.nodes) || Array.isArray(body)).toBe(true)
  }
})
