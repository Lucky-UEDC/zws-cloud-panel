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

test("WhatsApp logs endpoint returns structured response", async ({ page }) => {
  const resp = await page.request.get("/api/admin/whatsapp/logs?limit=5")
  if (resp.status() === 401) {
    test.skip(true, "Admin session unavailable over HTTP")
    return
  }
  expect([200, 404]).toContain(resp.status())
  if (resp.ok()) {
    const body = await resp.json()
    expect(Array.isArray(body.logs) || Array.isArray(body)).toBe(true)
  }
})

test("channel promotion API returns template body", async ({ page }) => {
  const resp = await page.request.get("/api/admin/whatsapp/settings/channel-promotion")
  if (resp.status() === 401) {
    test.skip(true, "Admin session unavailable over HTTP")
    return
  }
  expect(resp.ok()).toBeTruthy()
  const body = await resp.json()
  expect(body).toHaveProperty("ok", true)
  expect(body).toHaveProperty("body")
  expect(typeof body.body).toBe("string")
  expect(body.body.length).toBeGreaterThan(10)
})

test("channel promotion template can be updated via PUT", async ({ page }) => {
  const resp = await page.request.get("/api/admin/whatsapp/settings/channel-promotion")
  if (resp.status() === 401) {
    test.skip(true, "Admin session unavailable over HTTP")
    return
  }
  if (!resp.ok()) {
    test.skip(true, "Channel promotion endpoint not available")
    return
  }
  const current = await resp.json()
  const originalBody = current.body as string

  // Update with a modified template
  const updated = `${originalBody}\n\n[Test marker ${Date.now()}]`
  const putResp = await page.request.put("/api/admin/whatsapp/settings/channel-promotion", {
    data: { body: updated },
  })
  if (putResp.status() === 401) {
    test.skip(true, "Admin session unavailable over HTTP")
    return
  }
  expect(putResp.ok()).toBeTruthy()
  const putBody = await putResp.json()
  expect(putBody).toHaveProperty("ok", true)
  expect(putBody.body).toBe(updated)

  // Restore original
  await page.request.put("/api/admin/whatsapp/settings/channel-promotion", { data: { body: originalBody } })
})

test("WhatsApp campaigns list is accessible", async ({ page }) => {
  const resp = await page.request.get("/api/admin/whatsapp/campaigns")
  if (resp.status() === 401) {
    test.skip(true, "Admin session unavailable over HTTP")
    return
  }
  expect([200, 404]).toContain(resp.status())
  if (resp.ok()) {
    const body = await resp.json()
    expect(body.ok || Array.isArray(body.campaigns) || Array.isArray(body)).toBeTruthy()
  }
})
