import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { notificationMessageHash } from "@/lib/notifications/ledger"

function read(path: string) {
  return readFileSync(path, "utf8")
}

test("notification hash includes UTC day and stable business identity", () => {
  const date = new Date("2026-07-10T23:59:59.000Z")
  const first = notificationMessageHash({ customerId: "C1", invoiceId: "I1", templateId: "T1", channel: "whatsapp", event: "renewal_7d", date })
  const sameDay = notificationMessageHash({ customerId: "c1", invoiceId: "i1", templateId: "t1", channel: "WHATSAPP", event: "RENEWAL_7D", date: new Date("2026-07-10T00:00:00.000Z") })
  const nextDay = notificationMessageHash({ customerId: "C1", invoiceId: "I1", templateId: "T1", channel: "whatsapp", event: "renewal_7d", date: new Date("2026-07-11T00:00:00.000Z") })
  const email = notificationMessageHash({ customerId: "C1", invoiceId: "I1", templateId: "T1", channel: "email", event: "renewal_7d", date })
  assert.equal(first, sameDay)
  assert.notEqual(first, nextDay)
  assert.notEqual(first, email)
})

test("notification identity supports service events without an invoice", () => {
  const first = notificationMessageHash({ customerId: "C1", orderId: "O1", serviceId: "V1", templateId: "service_suspended", channel: "whatsapp", event: "service_suspended", scheduledFor: new Date("2026-07-11T10:00:00Z") })
  const duplicate = notificationMessageHash({ customerId: "c1", orderId: "o1", serviceId: "v1", templateId: "SERVICE_SUSPENDED", channel: "WHATSAPP", event: "SERVICE_SUSPENDED", scheduledFor: new Date("2026-07-11T23:00:00Z") })
  assert.equal(first, duplicate)
})

test("notification ledger migration enforces duplicate prevention", () => {
  const migration = read("prisma/migrations/20260710210500_notification_payment_stability/migration.sql")
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "notification_ledger"/)
  assert.match(migration, /"customer_id", "event", "invoice_id", "template_id"/)
  assert.match(migration, /"message_hash"/)
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS "notification_ledger_message_hash_key"/)
})

test("renewal worker calendar is bounded and has no legacy continuous overdue reminder", () => {
  const source = read("lib/renewals.ts")
  assert.match(source, /"3d" \| "2d" \| "1d" \| "due_day"/)
  assert.doesNotMatch(source, /OVERDUE_REMINDER_DAYS/)
  assert.doesNotMatch(source, /reminderType: "(?:overdue|suspension_warning|deletion_warning)"/)
  assert.match(source, /channels: input\.event === "service_suspended" \? \["email", "whatsapp"\] : \["email"\]/)
  assert.match(source, /reserveNotificationDelivery/)
})

test("order deletion preserves invoices and payment history", () => {
  const lifecycle = read("lib/vps-lifecycle.ts")
  assert.doesNotMatch(lifecycle, /deleteInvoicesPermanently/)
  assert.match(lifecycle, /preservedFinancialRecords/)
  assert.match(lifecycle, /paymentAttempt\.count/)
})

test("checkout migration selects one canonical session per invoice without deleting history", () => {
  const migration = read("prisma/migrations/20260711223000_checkout_notification_identity/migration.sql")
  assert.match(migration, /row_number\(\) OVER/)
  assert.match(migration, /checkout_sessions_one_order_payment_per_invoice_key/)
  assert.match(migration, /SET "invoiceId" = NULL/)
  assert.doesNotMatch(migration, /DELETE FROM "checkout_sessions"/)
})

test("order invoice notifications reserve a once-only ledger entry", () => {
  const service = read("lib/notifications/service.ts")
  assert.match(service, /reserveNotificationDelivery/)
  assert.match(service, /markNotificationDelivery/)
  assert.match(service, /channel:\s*"multi"/)
  assert.match(service, /input\.resend === true/)
  assert.match(service, /status:\s*"skipped"/)
})

test("whatsapp automation and diagnostics avoid permanent message body storage", () => {
  const automation = read("lib/whatsapp/automation.ts")
  const diagnostics = read("lib/whatsapp/diagnostics.ts")
  assert.match(automation, /reserveOutboundEventDelivery/)
  assert.match(automation, /duplicate_automation_event/)
  assert.match(diagnostics, /message:\s*null/)
  assert.doesNotMatch(diagnostics, /message:\s*input\.message \?/)
})

test("canonical Evolution webhook exposes readiness and the shared POST handler", () => {
  const route = read("app/api/whatsapp/webhook/route.ts")
  assert.match(route, /export async function GET\(\)/)
  assert.match(route, /provider: "evolution"/)
  assert.match(route, /return handleEvolutionWebhook\(request\)/)
})

test("production CSP permits the Cloudflare analytics beacon injected at the edge", () => {
  const config = read("next.config.mjs")
  assert.match(config, /https:\/\/static\.cloudflareinsights\.com/)
  assert.match(config, /https:\/\/cloudflareinsights\.com/)
})

test("operational log cleanup protects business-critical tables and defaults to dry run", () => {
  const cleanup = read("scripts/archive-purge-operational-logs.ts")
  assert.match(cleanup, /PROTECTED_MODELS/)
  assert.match(cleanup, /"invoice"/)
  assert.match(cleanup, /"payment"/)
  assert.match(cleanup, /"vpsInstance"/)
  assert.match(cleanup, /arg\("apply"\) === "true"/)
  assert.match(cleanup, /archive_verified_purge/)
  assert.match(cleanup, /dry_run/)
  assert.match(cleanup, /createGzip/)
  assert.match(cleanup, /checksumSha256/)
  assert.match(cleanup, /Archive row count mismatch/)
  assert.match(cleanup, /archive_verified_purge/)
})

test("public health hides detailed queue payloads and verbose output is local-only", () => {
  const health = read("app/api/health/route.ts")
  assert.match(health, /failed: Number\(queue\.stats\.failed/)
  assert.doesNotMatch(health, /url\.searchParams\.get\("verbose"\)/)
  assert.match(health, /return isLocalRequest\(request\)/)
  assert.match(health, /status: configured \? "configured" : "disabled"/)
  assert.match(health, /googleDriveReport\?\.enabled === false \? "disabled"/)
})

test("checkout sessions carry a 15 minute reservation and expiry cleanup", () => {
  const route = read("app/api/payments/create/route.ts")
  const cleanup = read("lib/checkout-reservations.ts")
  assert.match(route, /reservationExpiresAt = new Date\(reservedAt\.getTime\(\) \+ 15 \* 60 \* 1000\)/)
  assert.match(route, /reservedAt,\s+reservationExpiresAt,/)
  assert.match(cleanup, /releaseExpiredCheckoutReservations/)
  assert.match(cleanup, /reservation_expired/)
})

test("scheduled local backups default off unless explicitly enabled", () => {
  const scheduler = read("scripts/backup-scheduler.ts")
  assert.match(scheduler, /localBackupsEnabled/)
  assert.match(scheduler, /local backups disabled/)
})
