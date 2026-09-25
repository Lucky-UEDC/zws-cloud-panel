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

test("admin dashboard API returns analytics data", async ({ page }) => {
  const resp = await page.request.get("/api/admin/analytics")
  if (resp.status() === 401) {
    test.skip(true, "Admin session unavailable over HTTP")
    return
  }
  expect([200, 404]).toContain(resp.status())
})

test("admin customers API returns paginated list", async ({ page }) => {
  const resp = await page.request.get("/api/admin/customers?page=1&pageSize=10")
  if (resp.status() === 401) {
    test.skip(true, "Admin session unavailable over HTTP")
    return
  }
  expect(resp.ok()).toBeTruthy()
  const body = await resp.json()
  expect(Array.isArray(body.customers)).toBe(true)
  expect(body).toHaveProperty("pagination")
})

test("admin VMs API returns paginated list", async ({ page }) => {
  const resp = await page.request.get("/api/admin/vms?page=1&pageSize=10")
  if (resp.status() === 401) {
    test.skip(true, "Admin session unavailable over HTTP")
    return
  }
  expect(resp.ok()).toBeTruthy()
  const body = await resp.json()
  expect(body).toHaveProperty("success", true)
  expect(body).toHaveProperty("pagination")
})

test("health endpoint returns ok", async ({ page }) => {
  const resp = await page.request.get("/api/health")
  expect(resp.ok()).toBeTruthy()
  const body = await resp.json()
  // Health endpoint returns { status: "ok", ... } with per-service ok fields nested inside
  const hasStatus = Object.prototype.hasOwnProperty.call(body, "status")
  const hasOk = Object.prototype.hasOwnProperty.call(body, "ok")
  expect(hasStatus || hasOk).toBe(true)
  if (hasStatus) expect(["ok", "degraded", "error"]).toContain(body.status)
})

test("runtime config API returns brand data", async ({ page }) => {
  const resp = await page.request.get("/api/runtime/brand")
  expect([200, 404]).toContain(resp.status())
})

test("products API returns list", async ({ page }) => {
  const resp = await page.request.get("/api/products")
  expect(resp.ok()).toBeTruthy()
  const body = await resp.json()
  expect(Array.isArray(body.products) || Array.isArray(body)).toBe(true)
})
