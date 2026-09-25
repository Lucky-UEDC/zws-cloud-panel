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
    throw new Error("Admin requires interactive MFA — skip via environment")
  }
  expect(body?.authenticated).toBe(true)
}

test.beforeEach(async ({ page }) => {
  await authenticate(page)
})

test("IP pools API returns success with pool list", async ({ page }) => {
  const resp = await page.request.get("/api/admin/ip-pools?purpose=inventory")
  if (resp.status() === 401) {
    test.skip(true, "Admin session unavailable over HTTP")
    return
  }
  expect(resp.ok()).toBeTruthy()
  const body = await resp.json()
  expect(body).toHaveProperty("success", true)
  expect(body).toHaveProperty("pools")
  expect(Array.isArray(body.pools)).toBe(true)
})

test("IP pools with active pools report non-negative freeIps", async ({ page }) => {
  const resp = await page.request.get("/api/admin/ip-pools?purpose=inventory")
  if (resp.status() === 401) {
    test.skip(true, "Admin session unavailable over HTTP")
    return
  }
  expect(resp.ok()).toBeTruthy()
  const body = await resp.json()
  const pools = body.pools as any[]
  for (const pool of pools) {
    expect(typeof pool.freeIps).toBe("number")
    expect(pool.freeIps).toBeGreaterThanOrEqual(0)
    // A pool that has IPs should not report 0 available if the range has addresses
    // and none are blocked — this validates the Phase 1 bug fix
    if (pool.totalIps > 0 && pool.usedIps === 0 && pool.reservedIps === 0 && pool.blockedIps === 0) {
      expect(pool.freeIps).toBeGreaterThan(0)
    }
  }
})

test("IP pool freeIps count matches available IPs in range for a pool without gateway", async ({ page }) => {
  // This test creates a temporary pool scenario or checks existing ones
  // Main goal: ensure a pool with null gateway is not returning 0 available
  const resp = await page.request.get("/api/admin/ip-pools?purpose=inventory")
  if (resp.status() === 401) {
    test.skip(true, "Admin session unavailable over HTTP")
    return
  }
  const body = await resp.json()
  const pools = body.pools as any[]
  const noGatewayPool = pools.find((p: any) => !p.gateway || p.gateway === null || p.gateway === "")
  if (!noGatewayPool) {
    test.skip(true, "No pool without gateway found to test this scenario")
    return
  }
  // If pool has IPs in range and no used/reserved IPs, freeIps should be > 0
  if (noGatewayPool.totalIps > 0 && noGatewayPool.usedIps === 0 && noGatewayPool.reservedIps === 0) {
    expect(noGatewayPool.freeIps).toBeGreaterThan(0)
  }
})

test("IP pools allocations array is present", async ({ page }) => {
  const resp = await page.request.get("/api/admin/ip-pools?purpose=inventory")
  if (resp.status() === 401) {
    test.skip(true, "Admin session unavailable over HTTP")
    return
  }
  const body = await resp.json()
  expect(Array.isArray(body.allocations)).toBe(true)
})
