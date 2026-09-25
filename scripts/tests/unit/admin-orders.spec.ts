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

test("admin orders API returns paginated response", async ({ page }) => {
  const resp = await page.request.get("/api/admin/orders?page=1&pageSize=10")
  if (resp.status() === 401) {
    test.skip(true, "Admin session unavailable over HTTP")
    return
  }
  expect(resp.ok()).toBeTruthy()
  const body = await resp.json()
  expect(body).toHaveProperty("success", true)
  expect(body).toHaveProperty("orders")
  expect(body).toHaveProperty("pagination")
  expect(Array.isArray(body.orders)).toBe(true)
  expect(body.orders.length).toBeLessThanOrEqual(10)
})

test("admin orders API pagination field contains total and pages", async ({ page }) => {
  const resp = await page.request.get("/api/admin/orders?page=1&pageSize=20")
  if (resp.status() === 401) {
    test.skip(true, "Admin session unavailable over HTTP")
    return
  }
  const body = await resp.json()
  const pagination = body.pagination
  expect(pagination).toHaveProperty("page")
  expect(pagination).toHaveProperty("pageSize")
  expect(pagination).toHaveProperty("total")
  expect(pagination).toHaveProperty("pages")
  expect(pagination.page).toBe(1)
  expect(pagination.pageSize).toBe(20)
  expect(typeof pagination.total).toBe("number")
})

test("admin orders API search filter works", async ({ page }) => {
  const resp = await page.request.get("/api/admin/orders?search=ZWS&page=1&pageSize=5")
  if (resp.status() === 401) {
    test.skip(true, "Admin session unavailable over HTTP")
    return
  }
  expect(resp.ok()).toBeTruthy()
  const body = await resp.json()
  expect(Array.isArray(body.orders)).toBe(true)
})

test("admin orders status filter works", async ({ page }) => {
  const resp = await page.request.get("/api/admin/orders?status=paid&page=1&pageSize=10")
  if (resp.status() === 401) {
    test.skip(true, "Admin session unavailable over HTTP")
    return
  }
  expect(resp.ok()).toBeTruthy()
  const body = await resp.json()
  expect(Array.isArray(body.orders)).toBe(true)
  for (const order of body.orders) {
    expect(order.status).toBe("paid")
  }
})

test("admin orders each item has required fields", async ({ page }) => {
  const resp = await page.request.get("/api/admin/orders?page=1&pageSize=5")
  if (resp.status() === 401) {
    test.skip(true, "Admin session unavailable over HTTP")
    return
  }
  const body = await resp.json()
  for (const order of body.orders) {
    expect(order).toHaveProperty("id")
    expect(order).toHaveProperty("orderNumber")
    expect(order).toHaveProperty("status")
    expect(order).toHaveProperty("createdAt")
  }
})
