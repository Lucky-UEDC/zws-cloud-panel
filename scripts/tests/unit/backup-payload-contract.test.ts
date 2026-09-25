import assert from "node:assert/strict"
import test from "node:test"
import { buildVzdumpPayload } from "@/lib/proxmox"
import { sanitizeBackupRequest } from "@/lib/proxmox-backup"

test("vzdump payload is strictly whitelisted and never forwards notify", () => {
  const payload = buildVzdumpPayload(465543, {
    storage: "hdd2",
    mode: "snapshot",
    compress: "zstd",
    notesTemplate: "zws-policy:cmu1nfamr0000p7mfxsmou5vu",
    notify: "always",
  })
  assert.deepEqual(Object.keys(payload).sort(), ["compress", "mode", "notes-template", "storage", "vmid"])
  assert.equal(payload.storage, "hdd2")
  assert.equal("notify" in payload, false)
  assert.equal("notify" in (payload as Record<string, unknown>), false)
})

test("vzdump payload with no extras contains only base fields", () => {
  const payload = buildVzdumpPayload(42, { storage: "hdd2" })
  assert.deepEqual(Object.keys(payload).sort(), ["mode", "storage", "vmid"])
  assert.equal(payload.mode, "snapshot")
})

test("sanitizeBackupRequest keeps only allowed fields", () => {
  const { request, dropped, error } = sanitizeBackupRequest({
    policyId: "cmu1nfamr0000p7mfxsmou5vu",
    vmid: 465543,
    sync: true,
    actor: "system-admin",
    notify: "always",
    leaked: { secret: true },
    mode: "snapshot",
  })
  assert.equal(error, undefined)
  assert.deepEqual(dropped.sort(), ["leaked", "mode", "notify"])
  assert.deepEqual(Object.keys(request!), ["policyId", "vmid", "actor", "sync"])
})

test("sanitizeBackupRequest rejects missing policy id and invalid vmid", () => {
  const missing = sanitizeBackupRequest({ vmid: 5 })
  assert.equal(missing.request, null)
  assert.match(missing.error!, /policyId is required/)

  const badVmid = sanitizeBackupRequest({ policyId: "p", vmid: -1 })
  assert.equal(badVmid.request, null)
  assert.match(badVmid.error!, /positive integer/)
})

test("sanitizeBackupRequest rejects non-object payloads", () => {
  for (const value of [null, undefined, 42, "policy", ["a"]]) {
    const { request, error } = sanitizeBackupRequest(value)
    assert.equal(request, null)
    assert.match(error!, /Invalid backup request payload/)
  }
})