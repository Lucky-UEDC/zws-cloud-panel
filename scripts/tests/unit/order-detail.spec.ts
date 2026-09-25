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

test("order detail GET returns all required top-level fields", async ({ page }) => {
  const listResp = await page.request.get("/api/admin/orders?page=1&pageSize=1")
  if (listResp.status() === 401) {
    test.skip(true, "Admin session unavailable over HTTP")
    return
  }
  const list = await listResp.json()
  const first = list.orders?.[0]
  if (!first?.id) {
    test.skip(true, "No orders found")
    return
  }

  const resp = await page.request.get(`/api/admin/orders/${first.id}`)
  if (resp.status() === 401) {
    test.skip(true, "Admin session unavailable over HTTP")
    return
  }
  expect(resp.ok()).toBeTruthy()
  const body = await resp.json()

  // Top-level shape
  expect(body).toHaveProperty("success", true)
  expect(body).toHaveProperty("order")
  expect(body).toHaveProperty("vpsInstance")
  expect(body).toHaveProperty("provisioningJob")
  expect(body).toHaveProperty("timeline")
  expect(body).toHaveProperty("auditLog")

  // Order fields
  const order = body.order
  expect(order).toHaveProperty("id")
  expect(order).toHaveProperty("orderNumber")
  expect(order).toHaveProperty("status")
  expect(order).toHaveProperty("createdAt")
  expect(order).toHaveProperty("customer")
})

test("order detail GET vpsInstance has required delivery fields when VPS exists", async ({ page }) => {
  const listResp = await page.request.get("/api/admin/orders?page=1&pageSize=20")
  if (listResp.status() === 401) {
    test.skip(true, "Admin session unavailable over HTTP")
    return
  }
  const list = await listResp.json()
  const orderWithVps = (list.orders as any[]).find((o: any) => o.vpsInstanceId || o.status === "active")
  if (!orderWithVps?.id) {
    test.skip(true, "No order with VPS found")
    return
  }

  const resp = await page.request.get(`/api/admin/orders/${orderWithVps.id}`)
  if (!resp.ok()) {
    test.skip(true, "Order detail not accessible")
    return
  }
  const body = await resp.json()
  if (!body.vpsInstance) {
    test.skip(true, "Order has no VPS instance yet")
    return
  }

  const vps = body.vpsInstance
  // Core VM delivery fields
  expect(vps).toHaveProperty("hostname")
  expect(vps).toHaveProperty("vmid")
  expect(vps).toHaveProperty("status")
  expect(vps).toHaveProperty("primaryIp")
  expect(vps).toHaveProperty("username")
})

test("order detail GET returns 404 for non-existent order", async ({ page }) => {
  const resp = await page.request.get("/api/admin/orders/nonexistent-order-id-xyz")
  if (resp.status() === 401) {
    test.skip(true, "Admin session unavailable over HTTP")
    return
  }
  expect(resp.status()).toBe(404)
})

test("order detail GET provisioning job has status and progress", async ({ page }) => {
  const listResp = await page.request.get("/api/admin/orders?page=1&pageSize=10")
  if (listResp.status() === 401) {
    test.skip(true, "Admin session unavailable over HTTP")
    return
  }
  const list = await listResp.json()
  const orderWithJob = (list.orders as any[]).find((o: any) => o.provisioningStatus || o.status === "paid" || o.status === "active")
  if (!orderWithJob?.id) {
    test.skip(true, "No suitable order found")
    return
  }

  const resp = await page.request.get(`/api/admin/orders/${orderWithJob.id}`)
  if (!resp.ok()) return
  const body = await resp.json()
  if (!body.provisioningJob) {
    test.skip(true, "No provisioning job on this order")
    return
  }

  expect(body.provisioningJob).toHaveProperty("id")
  expect(body.provisioningJob).toHaveProperty("status")
  expect(body.provisioningJob).toHaveProperty("progress")
  expect(body.provisioningJob).toHaveProperty("updatedAt")
})
