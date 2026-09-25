import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import assert from "node:assert/strict"
import { fileURLToPath } from "node:url"
import { normalizeEvolutionUrl } from "@/lib/whatsapp/evolution"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), "utf8")
}

test("Evolution URLs without a scheme default to HTTPS", () => {
  assert.equal(
    normalizeEvolutionUrl("evolution-api-production-88a1.up.railway.app"),
    "https://evolution-api-production-88a1.up.railway.app",
  )
  assert.equal(
    normalizeEvolutionUrl("https://evolution-api-production-88a1.up.railway.app"),
    "https://evolution-api-production-88a1.up.railway.app",
  )
  assert.equal(
    normalizeEvolutionUrl("http://evolution-api-production-88a1.up.railway.app"),
    "http://evolution-api-production-88a1.up.railway.app",
  )
})

test("Evolution service validates connections through fetchInstances", () => {
  const source = read("lib/whatsapp/evolution.ts")
  const client = read("lib/whatsapp/evolution-client.ts")
  assert.match(source, /export \{ normalizeEvolutionUrl \}/)
  assert.match(client, /\/instance\/fetchInstances/)
  assert.match(client, /Authorization/)
  assert.match(source, /check\("api_key_valid"/)
  assert.match(source, /check\("instance_exists"/)
})

test("WhatsApp settings UI exposes the emergency Evolution controls", () => {
  const source = read("components/admin/whatsapp-manager.tsx")
  assert.match(source, /Server URL/)
  assert.match(source, /Global API Key/)
  assert.match(source, /Instance ID/)
  assert.match(source, /Instance Token/)
  assert.match(source, /readOnly/)
  assert.match(source, /Test Connection/)
  assert.match(source, /Send Test Message/)
  assert.doesNotMatch(source, /Instance Name/)
  assert.doesNotMatch(source, /Connected Number/)
})
