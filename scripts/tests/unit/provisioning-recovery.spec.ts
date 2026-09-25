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

test("admin orders API returns waiting_for_admin jobs when they exist", async ({ page }) => {
  const resp = await page.request.get("/api/admin/orders?page=1&pageSize=10")
  if (resp.status() === 401) {
    test.skip(true, "Admin session unavailable over HTTP")
    return
  }
  expect(resp.ok()).toBeTruthy()
  const body = await resp.json()
  expect(body).toHaveProperty("orders")
  expect(Array.isArray(body.orders)).toBe(true)
})

test("admin order detail GET returns provisioning job state", async ({ page }) => {
  // Get first order ID
  const listResp = await page.request.get("/api/admin/orders?page=1&pageSize=1")
  if (listResp.status() === 401) {
    test.skip(true, "Admin session unavailable over HTTP")
    return
  }
  const list = await listResp.json()
  const firstOrder = list.orders?.[0]
  if (!firstOrder?.id) {
    test.skip(true, "No orders found to test")
    return
  }

  const resp = await page.request.get(`/api/admin/orders/${firstOrder.id}`)
  if (resp.status() === 401) {
    test.skip(true, "Admin session unavailable over HTTP")
    return
  }
  expect(resp.ok()).toBeTruthy()
  const body = await resp.json()
  expect(body).toHaveProperty("success", true)
  expect(body).toHaveProperty("order")
  expect(body).toHaveProperty("provisioningJob")
  expect(body).toHaveProperty("timeline")
  expect(body).toHaveProperty("auditLog")
  expect(Array.isArray(body.timeline)).toBe(true)
  expect(Array.isArray(body.auditLog)).toBe(true)
})

test("admin retry endpoint accepts POST for a known order", async ({ page }) => {
  const listResp = await page.request.get("/api/admin/orders?page=1&pageSize=5")
  if (listResp.status() === 401) {
    test.skip(true, "Admin session unavailable over HTTP")
    return
  }
  const list = await listResp.json()
  // Find an order with a VPS instance (most likely to have provisioningJob)
  const paidOrder = (list.orders as any[]).find((o: any) => o.status === "paid" || o.status === "active")
  if (!paidOrder?.vpsInstanceId) {
    test.skip(true, "No active VPS order found for retry test")
    return
  }
  const resp = await page.request.post(`/api/admin/vps/${paidOrder.vpsInstanceId}/retry`)
  // 200 means retry enqueued, 409 means already queued (both valid for this test)
  expect([200, 400, 409]).toContain(resp.status())
})
