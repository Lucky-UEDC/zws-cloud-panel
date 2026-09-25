import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { isWhatsappDeliveryEnabled, normalizeFailsafeMode, WHATSAPP_FAILSAFE_MODES } from "@/lib/whatsapp/evolution"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
const read = (path: string) => readFileSync(`${root}/${path}`, "utf8")

test("failsafe mode normalization accepts only registered modes", () => {
  assert.equal(normalizeFailsafeMode("none"), "none")
  assert.equal(normalizeFailsafeMode("log_only"), "log_only")
  assert.equal(normalizeFailsafeMode("mark_failed"), "mark_failed")
  assert.equal(normalizeFailsafeMode("notify_admin"), "notify_admin")
  assert.equal(normalizeFailsafeMode("anything"), "none")
  assert.equal(normalizeFailsafeMode(undefined), "none")
  assert.equal(normalizeFailsafeMode(""), "none")
  assert.deepEqual(WHATSAPP_FAILSAFE_MODES, ["none", "log_only", "mark_failed", "notify_admin"])
})

test("master delivery switch defaults to enabled and only disables at false", () => {
  assert.equal(isWhatsappDeliveryEnabled(undefined), true)
  assert.equal(isWhatsappDeliveryEnabled({ enabled: true } as any), true)
  assert.equal(isWhatsappDeliveryEnabled({ enabled: false } as any), false)
})

test("the send funnel enforces the master switch before contacting the provider", () => {
  const send = read("lib/whatsapp/send.ts")
  assert.match(send, /deliverySettings\.enabled === false/)
  assert.match(send, /WhatsApp delivery is disabled by the master switch\./)
  assert.match(send, /failureReason: "delivery_disabled_by_admin"/)
})

test("failsafe modes are honored on provider failure in the send path", () => {
  const send = read("lib/whatsapp/send.ts")
  assert.match(send, /failsafe\.mode === "mark_failed"/)
  assert.match(send, /failsafe\.mode === "notify_admin"/)
  assert.match(send, /sendEmail\(\{[\s\S]*subject: "WhatsApp provider failure"/)
})

test("settings API persists enabled and failsafe alongside provider fields", () => {
  const route = read("app/api/admin/whatsapp/settings/route.ts")
  const lib = read("lib/whatsapp/evolution.ts")
  assert.match(route, /enabled: typeof body\.enabled === "boolean"/)
  assert.match(route, /failsafe: body\.failsafe/)
  assert.match(lib, /enabled: whatsappApi\.enabled === undefined \? configured : whatsappApi\.enabled !== false/)
  assert.match(lib, /notifyAdminEmail: text\(failsafeRaw\.notifyAdminEmail/ )
})

test("admin UI exposes one master switch and failsafe selector", () => {
  const manager = read("components/admin/whatsapp-manager.tsx")
  assert.match(manager, /Switch checked=\{settings\.enabled\}/)
  assert.match(manager, /onCheckedChange=\{\(checked\) => setSettings/)
  assert.match(manager, /Failsafe on provider failure/)
  assert.match(manager, /notify_admin/)
})

test("sidebar exposes a single merged WhatsApp group with a gateway subsection", () => {
  const sidebar = read("components/admin/admin-sidebar.tsx")
  assert.equal((sidebar.match(/label: "WhatsApp Gateway"/g) || []).length, 0)
  assert.match(sidebar, /label: "WhatsApp",\s*href: "\/admin\/whatsapp"/)
  assert.match(sidebar, /Gateway Settings", href: "\/admin\/whatsapp-gateway\/settings"/)
  assert.match(sidebar, /separator: true/)
})