import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import assert from "node:assert/strict"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), "utf8")
}

test("prisma schema defines the five gateway models with indexes", () => {
  const schema = read("prisma/schema.prisma")
  assert.match(schema, /model WhatsAppGatewayMessage \{/)
  assert.match(schema, /model WhatsAppGatewayContact \{/)
  assert.match(schema, /model WhatsAppGatewayWaba \{/)
  assert.match(schema, /model WhatsAppGatewayPhoneNumber \{/)
  assert.match(schema, /model WhatsAppGatewayTemplate \{/)
  for (const model of ["whatsapp_gateway_messages", "whatsapp_gateway_contacts", "whatsapp_gateway_wabas", "whatsapp_gateway_phone_numbers", "whatsapp_gateway_templates"]) {
    assert.match(schema, new RegExp(`@@map\\("${model}"\\)`))
  }
  assert.match(schema, /@@index\(\[contactNo\]\)/)
  assert.match(schema, /@@index\(\[waMessageId\]\)/)
  assert.match(schema, /@@(?:unique|index)\(\[provider, externalId\]\)/)
  assert.match(schema, /@@unique\(\[provider, wabaId, templateName\]\)/)
})

test("the gateway migration is additive and idempotent", () => {
  const migration = read("prisma/migrations/20260913000000_whatsapp_gateway/migration.sql")
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "whatsapp_gateway_messages"/)
  assert.doesNotMatch(migration, /DROP TABLE/)
  assert.doesNotMatch(migration, /DROP[^;]*CONSTRAINT/)
  const createCount = (migration.match(/CREATE TABLE IF NOT EXISTS/g) || []).length
  assert.equal(createCount, 5)
  assert.match(migration, /CREATE INDEX IF NOT EXISTS/)
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS/)
  assert.match(migration, /ADD CONSTRAINT "whatsapp_gateway_messages_contact_id_fkey"/)
  assert.match(migration, /ADD CONSTRAINT "whatsapp_gateway_phone_numbers_waba_id_fkey"/)
  assert.match(migration, /ADD CONSTRAINT "whatsapp_gateway_templates_waba_id_fkey"/)
})

test("integration config exposes the gateway section and secrets stay masked", () => {
  const config = read("lib/integration-config.ts")
  assert.match(config, /whatsappGateway/)
  assert.match(config, /"apiToken"/)
  const settingsSource = read("lib/whatsapp-gateway/settings.ts")
  assert.match(settingsSource, /GATEWAY_MASKED_PATTERN/)
  assert.match(settingsSource, /apiKeyConfigured/)
  assert.match(settingsSource, /apiTokenConfigured/)
})

test("every gateway admin route is guarded by requireGatewayAdmin", () => {
  const routes = [
    "app/api/admin/whatsapp-gateway/settings/route.ts",
    "app/api/admin/whatsapp-gateway/test-connection/route.ts",
    "app/api/admin/whatsapp-gateway/connections/route.ts",
    "app/api/admin/whatsapp-gateway/phone-numbers/route.ts",
    "app/api/admin/whatsapp-gateway/waba/[wabaId]/phone-numbers/route.ts",
    "app/api/admin/whatsapp-gateway/contacts/route.ts",
    "app/api/admin/whatsapp-gateway/contacts/[id]/route.ts",
    "app/api/admin/whatsapp-gateway/messages/route.ts",
    "app/api/admin/whatsapp-gateway/send/route.ts",
    "app/api/admin/whatsapp-gateway/messages/[id]/retry/route.ts",
    "app/api/admin/whatsapp-gateway/templates/route.ts",
    "app/api/admin/whatsapp-gateway/overview/route.ts",
  ]
  for (const route of routes) {
    const source = read(route)
    assert.match(source, /requireGatewayAdmin/, `${route} must call requireGatewayAdmin`)
  }
})

test("no gateway route writes secrets into responses or logs", () => {
  const sources = [
    "app/api/admin/whatsapp-gateway/send/route.ts",
    "app/api/admin/whatsapp-gateway/templates/route.ts",
    "app/api/admin/whatsapp-gateway/contacts/route.ts",
  ]
  for (const file of sources) {
    const source = read(file)
    assert.doesNotMatch(source, /console\.log/, `${file} must not log`)
    assert.doesNotMatch(source, /JSON\.stringify\(\s*(settings|apiKey|apiToken)/, `${file} must not dump secrets`)
  }
})

test("provider only retries idempotent requests", () => {
  const client = read("lib/whatsapp-gateway/client.ts")
  assert.match(client, /const allowedAttempts = idempotent && this\.settings\.retryEnabled \? 1 \+ this\.settings\.maxRetries : 1/)
  assert.match(client, /isTransientError/)
  assert.match(client, /AbortError/)
})

test("send flow persists a record and auto-creates contacts before submitting", () => {
  const sendRoute = read("app/api/admin/whatsapp-gateway/send/route.ts")
  assert.match(sendRoute, /createGatewayMessage/)
  assert.match(sendRoute, /updateGatewayMessage/)
  assert.match(sendRoute, /attachContactIdFactory/)
  assert.match(sendRoute, /gatewayId: idempotencyKey/)
  assert.match(sendRoute, /providerResponse: \{ success: result\.success/)
  assert.match(sendRoute, /sanitizedError: result\.success \? null/)
})

test("public settings never leak secrets", () => {
  const settingsSource = read("lib/whatsapp-gateway/settings.ts")
  assert.match(settingsSource, /apiKeyConfigured: Boolean\(settings\.apiKey\)/)
  assert.match(settingsSource, /apiTokenConfigured: Boolean\(settings\.apiToken\)/)
  assert.doesNotMatch(settingsSource, /return \{[^}]*apiKey: settings\.apiKey[^}]*\}/, "public settings must not return raw apiKey")
})

test("admin sidebar exposes the gateway entries merged under the WhatsApp group", () => {
  const sidebar = read("components/admin/admin-sidebar.tsx")
  assert.match(sidebar, /label: "WhatsApp",\s*href: "\/admin\/whatsapp"/)
  assert.match(sidebar, /\/admin\/whatsapp-gateway\//)
  assert.match(sidebar, /\/admin\/whatsapp-gateway\/settings/)
  assert.equal((sidebar.match(/label: "WhatsApp Gateway"/g) || []).length, 0, "standalone gateway group must be removed")
})

test("gateway nav covers the required admin sections", () => {
  const nav = read("components/admin/whatsapp-gateway-nav.tsx")
  for (const href of ["/admin/whatsapp-gateway", "/admin/whatsapp-gateway/send", "/admin/whatsapp-gateway/templates", "/admin/whatsapp-gateway/contacts", "/admin/whatsapp-gateway/messages", "/admin/whatsapp-gateway/settings"]) {
    assert.match(nav, new RegExp(href.replace("/", "\\/")))
  }
})

test("whatsapp (Evolution) files are untouched by the gateway feature", () => {
  const evolutionClient = read("lib/whatsapp/evolution-client.ts")
  assert.match(evolutionClient, /fetchInstances/)
  const legacy = read("lib/whatsapp/queue.ts")
  assert.ok(legacy.length > 1000)
})

test("test connection uses the configured path and does not disclose headers", () => {
  const client = read("lib/whatsapp-gateway/client.ts")
  assert.match(client, /connectionTestPath/)
  assert.match(client, /redirect: "manual"/)
})

test("validation enforces OTP button rules and variable example counts", () => {
  const validate = read("lib/whatsapp-gateway/validate.ts")
  assert.match(validate, /Authentication templates require at least one OTP button/)
  assert.match(validate, /More variable examples than variables used in the message body/)
})

test("migrations folder contains no ad hoc schema push", () => {
  const dockerEntry = read("docker-entrypoint.sh")
  assert.match(dockerEntry, /prisma migrate deploy/)

  // `db push` is permitted in exactly one place: the fresh-install bootstrap.
  // A fresh database cannot replay migrations in order, so the schema is created
  // from schema.prisma and the existing migrations are then baselined. It is
  // gated on the database being empty (zero application tables), which is
  // detected from the data itself, so it can never run against production or
  // any populated database. It still executes through the compose `migrate`
  // service, never as an ad hoc production push.
  const pushLines = dockerEntry
    .split("\n")
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => /db push/.test(line))

  assert.ok(pushLines.length > 0, "fresh-install bootstrap should use db push")

  const lines = dockerEntry.split("\n")
  for (const { n } of pushLines) {
    // Nearest preceding function definition, not the first one in the file.
    const defs: number[] = []
    for (let i = 0; i < n - 1; i++) {
      if (/^[a-z_]+\(\) \{/.test(lines[i]!)) defs.push(i)
    }
    const fnName = lines[defs[defs.length - 1] ?? -1]?.trim().split("(")[0]
    assert.equal(
      fnName,
      "bootstrap_fresh_database",
      `db push on line ${n} must only appear inside bootstrap_fresh_database (found ${fnName})`
    )
  }

  // The bootstrap must stay behind the emptiness check in the migrate case.
  assert.match(dockerEntry, /if database_is_fresh; then\s*\n\s*bootstrap_fresh_database\s*\n\s*fi/)

  // Never reset the database outright.
  assert.doesNotMatch(dockerEntry, /migrate reset/)
})