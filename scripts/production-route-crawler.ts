import "dotenv/config"

const baseUrl = (process.env.BASE_URL || process.env.APP_URL || "http://127.0.0.1:3000").replace(/\/+$/, "")
const requiredPaths = [
  "/",
  "/pricing",
  "/login",
  "/register",
  "/client-area",
  "/client-area/vps",
  "/client-area/billing",
  "/client-area/support",
  "/admin",
  "/admin/vms",
  "/admin/orders",
  "/admin/logs",
  "/admin/analytics",
  "/admin/bandwidth",
  "/admin/backups",
  "/admin/compute-nodes",
  "/admin/whatsapp/contacts",
  "/admin/whatsapp/conversations",
  "/admin/whatsapp/auto-replies",
  "/admin/whatsapp/webhook-logs",
  "/api/health",
  "/api/runtime/config",
  "/api/storage-pools",
]

const apiPaths = [
  "/api/admin/bandwidth",
  "/api/admin/proxmox/vms",
  "/api/admin/whatsapp/overview",
  "/api/admin/whatsapp/contacts",
  "/api/admin/whatsapp/conversations",
  "/api/admin/whatsapp/auto-replies",
]

async function check(path: string, authenticated = false) {
  const response = await fetch(`${baseUrl}${path}`, {
    redirect: "manual",
    headers: {
      "User-Agent": "zws-production-route-crawler/1.0",
      ...(process.env.FRONTEND_VERIFY_COOKIE && authenticated ? { Cookie: process.env.FRONTEND_VERIFY_COOKIE } : {}),
    },
  }).catch((error) => ({ ok: false, status: 0, statusText: error?.message || "request_failed" }) as Response)
  const status = Number((response as Response).status || 0)
  if (path === "/api/health" && status === 503) {
    return { path, status }
  }
  if (status === 404 || status >= 500 || status === 0) {
    throw new Error(`${path} returned ${status || "network failure"} ${(response as Response).statusText || ""}`.trim())
  }
  return { path, status }
}

const results = []
for (const path of requiredPaths) results.push(await check(path, path.startsWith("/admin") || path.startsWith("/client-area")))
for (const path of apiPaths) results.push(await check(path, true))

console.log(JSON.stringify({ ok: true, baseUrl, checked: results.length, results }, null, 2))
