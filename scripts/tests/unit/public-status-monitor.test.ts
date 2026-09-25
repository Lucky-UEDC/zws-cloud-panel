import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"

const root = process.cwd()
const page = fs.readFileSync(path.join(root, "app/status/page.tsx"), "utf8")
const monitor = fs.readFileSync(path.join(root, "components/status/live-platform-status.tsx"), "utf8")
const healthRoute = fs.readFileSync(path.join(root, "app/api/health/route.ts"), "utf8")
const diagnosticsRoute = fs.readFileSync(path.join(root, "app/api/admin/diagnostics/route.ts"), "utf8")

test("public status page reports live health without fabricated service data", () => {
  assert.match(page, /LivePlatformStatus/)
  assert.doesNotMatch(page, /placeholder status page|99\.993|Compute \(BOM\)|Elevated latency in FRA/)
  assert.match(monitor, /fetch\("\/api\/health", \{ cache: "no-store" \}\)/)
  assert.match(monitor, /window\.setInterval\(refresh, 30_000\)/)
  assert.match(monitor, /operational|degraded|unavailable/)
})

test("PM2 probes survive release-directory replacement", () => {
  for (const source of [healthRoute, diagnosticsRoute]) {
    assert.match(source, /execFileAsync\("pm2", \["jlist"\], \{ cwd: "\/"/)
  }
})

test("configured WhatsApp outages degrade aggregate platform health", () => {
  assert.match(healthRoute, /const whatsappRequired = queuesReport\?\.whatsappConfigured === true/)
  assert.match(healthRoute, /!whatsappRequired \|\| \(whatsapp\.ok && whatsappReport\?\.connected === true && whatsappReport\?\.workerHeartbeatFresh === true\)/)
})
