import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { normalizeServerTag, isRejectedServerTag, friendlyVmDisplayName, instanceDisplayName } from "@/lib/vm-hostname"

const root = process.cwd()

function read(rel: string) {
  return fs.readFileSync(path.join(root, rel), "utf8")
}

// ---------------------------------------------------------------------------
// Server Tag normalization (spec Part 1.3)
// ---------------------------------------------------------------------------

test("normalizeServerTag keeps letters, digits, spaces, hyphens and underscores", () => {
  assert.equal(normalizeServerTag("Production DB"), "Production DB")
  assert.equal(normalizeServerTag("vm-01_backup"), "vm-01_backup")
  assert.equal(normalizeServerTag("  api-server  "), "api-server")
})

test("normalizeServerTag strips control characters, emoji and unsafe symbols", () => {
  assert.equal(normalizeServerTag("prod\u0000node\u0007"), "prod node")
  assert.equal(normalizeServerTag("🖥️ Web"), "Web")
  assert.equal(normalizeServerTag("a;drop&rm"), "a drop rm") // separators collapse
  assert.equal(normalizeServerTag("pay.me<x>"), "pay me x")
})

test("normalizeServerTag collapses whitespace and trims", () => {
  assert.equal(normalizeServerTag(" Multi    spaced   "), "Multi spaced")
})

test("normalizeServerTag caps at 64 characters", () => {
  const tag = normalizeServerTag("a".repeat(200))
  assert.equal(tag.length, 64)
  assert.equal(tag, "a".repeat(64))
})

test("normalizeServerTag returns empty for blank input", () => {
  assert.equal(normalizeServerTag(""), "")
  assert.equal(normalizeServerTag("   "), "")
  assert.equal(normalizeServerTag(null), "")
  assert.equal(normalizeServerTag(undefined), "")
})

test("isRejectedServerTag flags only non-empty inputs that leave nothing usable", () => {
  assert.equal(isRejectedServerTag(""), false)
  assert.equal(isRejectedServerTag("  "), false)
  assert.equal(isRejectedServerTag("Production DB"), false)
  assert.equal(isRejectedServerTag("🚀"), true)
  assert.equal(isRejectedServerTag("!!!"), true)
  assert.equal(isRejectedServerTag("\u0000\u0001"), true)
})

// ---------------------------------------------------------------------------
// Friendly VM display name (spec Parts 1.6 / 1.7 / 7)
// ---------------------------------------------------------------------------

test("friendlyVmDisplayName prefers the customer Server Tag over internal names", () => {
  const name = friendlyVmDisplayName({ displayTag: "Production DB", instanceName: "zws.old-cluster", hostname: "zws-9a5f", vmid: 465543 })
  assert.equal(name, "Production DB")
  // identical to friendlyVmDisplayName({ serverTag: ... }) legacy key
  assert.equal(friendlyVmDisplayName({ serverTag: "Legacy Tag", vmid: 1 }), "Legacy Tag")
})

test("friendlyVmDisplayName falls back to the canonical IP hostname, never infrastructure ids", () => {
  const name = friendlyVmDisplayName({ ipAddress: "103.216.170.230", vmid: 465543, instanceName: "zws.legacy", hostname: "zws-9a5f" })
  assert.equal(name, "ip-103-216-170-230")
})

test("friendlyVmDisplayName never leaks vmid/node/storage as the primary label", () => {
  const name = friendlyVmDisplayName({ vmid: 465543, node: "pve-x", hostname: null, ipAddress: null })
  assert.notEqual(name, "465543")
  assert.doesNotMatch(name, /pve-x/)
})

test("instanceDisplayName keeps the IP canonical form by design", () => {
  assert.equal(instanceDisplayName({ ipAddress: "1.2.3.4", vmid: 99 }), "ip-1-2-3-4")
})

// ---------------------------------------------------------------------------
// Client backup delete endpoint (Phase 1): authorization + artifact-first order
// ---------------------------------------------------------------------------

test("client backup delete requires vpsInstanceId and the DELETE confirmation token", () => {
  const source = read("app/api/client/backups/[id]/delete/route.ts")
  assert.match(source, /vpsInstanceId = String\(url\.searchParams\.get\("vpsInstanceId"\) \|\| ""\)/)
  assert.match(source, /confirmation !== "DELETE"/)
  assert.match(source, /confirmation = String\(url\.searchParams\.get\("confirmation"\)/)
  assert.match(source, /Deletion requires the confirmation token "DELETE"/)
})

test("client backup delete is ownership-scoped to the authenticated customer", () => {
  const source = read("app/api/client/backups/[id]/delete/route.ts")
  // customerId derived ONLY from the session cookie, then every lookup filters by it.
  assert.match(source, /const customer = await getClientFromCookies\(\)/)
  assert.match(source, /if \(!customer\?\.sub\) return NextResponse\.json\(\{ success: false, error: "Unauthorized" \}/)
  assert.match(source, /prisma\.vpsInstance\.findFirst\(\{ where: \{ id: vpsInstanceId, customerId, deletedAt: null \} \}\)/)
  assert.match(source, /prisma\.vmBackup\.findFirst\(\{ where: \{ id, customerId, vpsInstanceId \} \}\)/)
})

test("client backup delete never reduces usage before storage deletion confirms", () => {
  const source = read("app/api/client/backups/[id]/delete/route.ts")
  const artifactDeleteIndex = source.indexOf("deleteVmBackup(node.nodeName, storageName, volid)")
  const rebuildIndex = source.indexOf("rebuildBackupUsage({ customerId, persist: true })")
  const statusUpdateIndex = source.indexOf('status: "cancelled"')
  assert.ok(artifactDeleteIndex >= 0, "artifact delete present")
  assert.ok(rebuildIndex > artifactDeleteIndex, "usage rebuild happens after artifact delete")
  assert.ok(statusUpdateIndex > artifactDeleteIndex, "DB status change happens after artifact delete")
  assert.match(source, /Usage is NEVER reduced before the storage artifact is actually removed/)
})

test("client backup delete marks the row cancelled (soft) instead of hard-deleting, with audit trail", () => {
  const source = read("app/api/client/backups/[id]/delete/route.ts")
  assert.match(source, /data: \{\s*status: "cancelled",\s*completedAt: backup\.completedAt \|\| new Date\(\),\s*metadata: \{ \.\.\.metadata, deletedByCustomer: true/)
  assert.match(source, /eventType: "backup_deleted"/)
  assert.match(source, /eventType: "backup_delete_failed"/)
  assert.match(source, /oldValue: \{ status: backup\.status, sizeBytes/)
  assert.match(source, /newValue: \{ status: "cancelled", deletedByCustomer: true, artifactDeleted \}/)
})

// ---------------------------------------------------------------------------
// Client Server Tag endpoint (Phase 2.4)
// ---------------------------------------------------------------------------

test("client tag endpoint sanitizes via shared lib and audits the change", () => {
  const source = read("app/api/client/vps/[id]/tag/route.ts")
  assert.match(source, /import \{ normalizeServerTag, isRejectedServerTag \} from "@\/lib\/vm-hostname"/)
  assert.match(source, /const serverTag = normalizeServerTag\(rawTag\)/)
  assert.match(source, /isRejectedServerTag\(rawTag\)/)
  assert.match(source, /data: \{ displayTag: serverTag \|\| null \}/)
  assert.match(source, /eventType: "server_tag_changed"/)
})

test("client tag endpoint never touches hostname or Proxmox identity", () => {
  const source = read("app/api/client/vps/[id]/tag/route.ts")
  assert.match(source, /Only the friendly display tag is editable by the customer/)
  assert.doesNotMatch(source, /data: \{ hostname:/)
})

// ---------------------------------------------------------------------------
// Checkout: Server Tag replaces editable hostname (Phase 2.2)
// ---------------------------------------------------------------------------

test("checkout draft carries serverTag and the server hostname requirement is gone", () => {
  const checkout = read("app/checkout/CheckoutContent.tsx")
  const bootstrap = read("lib/checkout-bootstrap.ts")
  assert.match(checkout, /serverTag: string/)
  assert.match(bootstrap, /serverTag: "",/)
  assert.match(checkout, /Server Tag \(optional\)/)
  assert.match(checkout, /const effectiveHostname = ""/)
  assert.doesNotMatch(checkout, /validCheckoutHostname\(/)
  assert.doesNotMatch(checkout, /Enter a valid Linux hostname before payment/)
  // Client-side tag sanitization mirrors the server lib.
  assert.match(checkout, /clientNormalizeServerTag\(current\.serverTag\)/)
  assert.match(checkout, /clientRejectedServerTag\(current\.serverTag\)/)
})

test("checkout submits displayTag and never a customer-supplied hostname", () => {
  const checkout = read("app/checkout/CheckoutContent.tsx")
  assert.match(checkout, /displayTag: effectiveServerTag \|\| undefined,/)
  assert.match(checkout, /hostname: effectiveHostname,/)
})

// ---------------------------------------------------------------------------
// Checkout: Account Credit payment method (Phase 3)
// ---------------------------------------------------------------------------

test("checkout bootstrap resolves the wallet balance server-side for signed-in clients", () => {
  const checkout = read("app/checkout/CheckoutContent.tsx")
  const bootstrap = read("lib/checkout-bootstrap.ts")
  assert.match(checkout, /walletBalance: number \| null/)
  assert.match(bootstrap, /walletBalance: await clientWalletBalance\(\),/)
  assert.match(bootstrap, /clientWalletBalance\(\)/)
  assert.match(bootstrap, /prisma\.customer\.findUnique\(\{[\s\S]*?select: \{ walletBalance: true \}/)
  assert.match(bootstrap, /getClientFromCookies\(\)/)
})

test("wallet payment is gated on eligibility and never opens a gateway", () => {
  const checkout = read("app/checkout/CheckoutContent.tsx")
  // The wallet path requires the balance to cover the final payable amount.
  assert.match(checkout, /if \(!creditEligible\) return failCheckout\("Your Account Credit balance is not enough for this purchase/)
  assert.match(checkout, /const creditEligible = useMemo\(\(\) => creditLoaded && creditBalance >= payableToday/)
  // Gateway is only derived for gateway payments; wallet skips the gateway entirely.
  assert.match(checkout, /const gatewayAtSubmit = method === "gateway" \? selectedGateway : null/)
  // The wallet success path must NOT start a payment redirect (no gateway to open).
  const walletIndex = checkout.indexOf('if (returnedGateway === "wallet")')
  const redirectIndex = checkout.indexOf("startPaymentRedirect(data")
  assert.ok(walletIndex >= 0, "wallet branch present")
  assert.ok(redirectIndex > walletIndex, "wallet branch short-circuits before startPaymentRedirect")
  assert.match(checkout, /Paid from Account Credit/)
})

test("wallet settle shows a receipt instead of a gateway redirect", () => {
  const checkout = read("app/checkout/CheckoutContent.tsx")
  assert.match(checkout, /setPaymentState\("verified"\)/)
  assert.match(checkout, /\/client-area\/billing\?tab=invoices/)
  assert.match(checkout, /firstPaymentString\(data\?\.redirectUrl, data\?\.redirect_url\) \|\| "\/client-area\/billing\?tab=invoices"/)
})

test("checkout sends paymentMethod and only sends preferredGateway for gateway payments", () => {
  const checkout = read("app/checkout/CheckoutContent.tsx")
  assert.match(checkout, /paymentMethod: method,/)
  assert.match(checkout, /preferredGateway: method === "gateway" \? gatewayAtSubmit : undefined,/)
})

test("checkout surfaces the Account Credit option with the live balance", () => {
  const checkout = read("app/checkout/CheckoutContent.tsx")
  assert.match(checkout, /Pay with Account Credit/)
  assert.match(checkout, /Available: \{displayMoney\(creditBalance\)\}/)
  assert.match(checkout, /fetch\("\/api\/client\/wallet"/)
  // Auto-select when the balance covers the payable amount and the customer has
  // not explicitly chosen a gateway.
  assert.match(checkout, /methodUserChoiceRef\.current === null\) setPaymentMethod\("wallet"\)/)
  assert.match(checkout, /methodUserChoiceRef\.current = "gateway"/)
})

// ---------------------------------------------------------------------------
// Client VM identity surfaces (Phase 2.3)
// ---------------------------------------------------------------------------

test("client VPS APIs expose displayTag + friendly name but hide infrastructure ids", () => {
  const list = read("app/api/client/vps/route.ts")
  assert.match(list, /displayTag: typeof vps\.displayTag === "string" \? vps\.displayTag : null,/)
  assert.match(list, /name: friendlyVmDisplayName\(/)
  assert.match(list, /hostnameFromIp\(vps\.ipAddress\)/)
  const detail = read("lib/vm-db-truth.ts")
  assert.match(detail, /displayTag: typeof vps\.displayTag === "string" \? vps\.displayTag : null,/)
  assert.match(detail, /name: friendlyVmDisplayName\(vps\) \|\| instanceDisplayName\(vps\)/)
})

test("client backup rows never leak the storage artifact name", () => {
  const detail = read("lib/vm-db-truth.ts")
  assert.doesNotMatch(detail, /fileName: archive,/)
  assert.match(detail, /The internal storage artifact name \(volid\/fileName\) is NEVER exposed to/)
  const list = read("app/api/client/backups/route.ts")
  assert.match(list, /fileName: null,/)
})

// ---------------------------------------------------------------------------
// Migration (Phase 2.1): displayTag is additive
// ---------------------------------------------------------------------------

test("display_tag migration is additive and maps to displayTag", () => {
  const migration = read("prisma/migrations/20260925000001_display_tag/migration.sql")
  assert.match(migration, /ALTER TABLE "vps_instances" ADD COLUMN "display_tag" TEXT/)
  assert.doesNotMatch(migration, /DROP COLUMN/)
  const schema = read("prisma/schema.prisma")
  assert.match(schema, /displayTag\s+String\?\s+@map\("display_tag"\)/)
})