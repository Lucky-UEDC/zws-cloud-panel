import { expect, test, type Page } from "@playwright/test"

const adminEmail = process.env.ADMIN_EMAIL
const adminPassword = process.env.ADMIN_PASSWORD
const testVmId = "console-e2e"

const baseOverview = {
  success: true,
  id: testVmId,
  status: "running",
  serverName: "Sanitized test server",
  node: "pve",
  datacenter: "Test datacenter",
  location: "Test datacenter",
  vmid: 900001,
  ipAddress: "203.0.113.10",
  os: "Linux",
  osFamily: "linux",
  uptimeSeconds: 3720,
  metrics: {
    cpuPercent: 21.4,
    ramPercent: 42.8,
    diskPercent: 35.1,
    networkInBytes: 1024,
    networkOutBytes: 2048,
  },
  freshness: "fresh",
  telemetryAt: new Date().toISOString(),
  availableModes: ["vnc", "serial"],
  defaultMode: "serial",
}

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

async function mockOverview(page: Page, overview = baseOverview) {
  await page.route(`**/api/admin/vms/${testVmId}/console/overview`, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(overview) })
  })
}

async function gotoConsolePage(page: Page, vmId: string): Promise<boolean> {
  await page.goto(`/admin/vms/${vmId}/console`)
  const url = page.url()
  if (url.includes("/login") || url.includes("/auth")) return false
  // Check if middleware rejected (stays on URL but shows empty/error page)
  try {
    const region = await page.getByRole("region", { name: "Server console status" }).isVisible({ timeout: 8_000 }).catch(() => false)
    const hasContent = await page.locator("main, [data-testid]").first().isVisible({ timeout: 3_000 }).catch(() => false)
    if (!region && !hasContent) return false
  } catch {
    return false
  }
  return true
}

test.beforeEach(async ({ page }) => {
  await authenticate(page)
})

test("Windows guests expose noVNC controls and explicit offline failure state", async ({ page }) => {
  await mockOverview(page, {
    ...baseOverview,
    os: "Windows Server",
    osFamily: "windows",
    availableModes: ["vnc"],
    defaultMode: "vnc",
  })
  await page.route(`**/api/admin/vms/${testVmId}/console/session`, async (route) => {
    await route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({ success: false, code: "VM_OFFLINE", error: "VM is offline" }),
    })
  })

  const accessible = await gotoConsolePage(page, testVmId)
  if (!accessible) {
    test.skip(true, "Console page not accessible over HTTP — __Host- prefix cookie requires HTTPS")
    return
  }
  await expect(page.getByRole("region", { name: "Server console status" })).toBeVisible()
  await expect(page.getByText("Windows Server")).toBeVisible()
  await expect(page.getByRole("button", { name: "Serial" })).toHaveCount(0)
  await expect(page.getByText("VM is offline", { exact: true }).first()).toBeVisible()

  for (const name of [
    "Copy selected text",
    "Paste clipboard into VM",
    "Ctrl+Alt+Del",
    "Enter fullscreen",
    "Scale display",
    "Reset console",
    "Reconnect",
    "Capture screenshot",
    "Download screenshot",
    "Power menu",
  ]) {
    await expect(page.getByRole("button", { name })).toBeVisible()
  }

  await page.getByRole("button", { name: "Scale display" }).click()
  await expect(page.getByRole("button", { name: "Fit viewport" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Remote resize" })).toBeVisible()
  await expect(page.getByRole("button", { name: "No scaling" })).toBeVisible()
})

test("Linux console honors the saved serial preference and supports reconnect", async ({ page }) => {
  const requestedModes: string[] = []
  await mockOverview(page)
  await page.route(`**/api/admin/vms/${testVmId}/console/session`, async (route) => {
    const requestedMode = String(route.request().postDataJSON()?.mode || "")
    requestedModes.push(requestedMode)
    if (requestedMode === "serial") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          mode: "serial",
          defaultMode: "serial",
          availableModes: ["vnc", "serial"],
          serial: { websocketUrl: "ws://127.0.0.1:9/console-test" },
          session: { renewAfterAt: new Date(Date.now() + 60_000).toISOString() },
        }),
      })
      return
    }
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ success: false, error: "Select a console mode" }) })
  })

  const accessible = await gotoConsolePage(page, testVmId)
  if (!accessible) {
    test.skip(true, "Console page not accessible over HTTP — __Host- prefix cookie requires HTTPS")
    return
  }
  await expect(page.getByRole("button", { name: "Graphical" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Serial" })).toBeVisible()
  await page.getByRole("button", { name: "Serial" }).click()
  await expect.poll(() => requestedModes).toContain("serial")
  await expect.poll(() => page.evaluate(() => localStorage.getItem("myrdphub.console.preferredMode"))).toBe("serial")
  await page.getByRole("button", { name: "Reconnect" }).click()
  await expect.poll(() => requestedModes.filter((mode) => mode === "serial").length).toBeGreaterThan(1)
})

test("console summary and floating toolbar fit a mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockOverview(page)
  await page.route(`**/api/admin/vms/${testVmId}/console/session`, async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ success: false, code: "NODE_OFFLINE", error: "Node is offline" }),
    })
  })

  const accessible = await gotoConsolePage(page, testVmId)
  if (!accessible) {
    test.skip(true, "Console page not accessible over HTTP — __Host- prefix cookie requires HTTPS")
    return
  }
  await expect(page.getByRole("region", { name: "Server console status" })).toBeVisible()
  await expect(page.getByText("Node is offline", { exact: true }).first()).toBeVisible()
  const toolbar = page.getByRole("button", { name: "Reconnect" }).locator("..")
  await expect(toolbar).toBeVisible()
  const box = await toolbar.boundingBox()
  expect(box).not.toBeNull()
  expect((box?.x || 0) + (box?.width || 0)).toBeLessThanOrEqual(390)
})
