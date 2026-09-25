import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

function read(path: string) {
  return readFileSync(path, "utf8")
}

// Problem C: infrastructure details (hdd2 disk, Proxmox node, storage id) must
// never reach the customer UI. Fields are stripped server-side and the client
// pages no longer reference them (types, columns, dialog rows, card lines).
//
// NOTE: these are payload-scope assertions — a route may legitimately mention
// "node"/"storage" in internal code or explanatory comments as long as nothing
// is RETURNED to the customer.

function responsePayload(routeSource: string): string {
  // Use the final response construction (the real payload) — earlier returns
  // are auth guards.
  const last = routeSource.lastIndexOf("return NextResponse.json(")
  if (last === -1) return routeSource
  return routeSource.slice(last)
}

test("PART29 vm-context route does not return storage ids, storages, or disk capacity", () => {
  const route = read("app/api/client/backups/vm-context/route.ts")
  const payload = responsePayload(route)
  assert.ok(!/storageId/.test(payload), "vm-context response must not include storageId")
  assert.ok(!/storages/.test(payload), "vm-context response must not include storages")
  assert.ok(!/maxdisk/.test(payload), "vm-context response must not include maxdisk")
  assert.ok(!/volid|volId/.test(payload), "vm-context response must not include volume id")
})

test("PART29 backups list route does not return storageId", () => {
  const route = read("app/api/client/backups/route.ts")
  const payload = responsePayload(route)
  assert.ok(!/storageId/.test(payload), "backups list response must not include storageId")
})

test("PART29 progress route does not return storage or volid", () => {
  const route = read("app/api/client/backups/[id]/progress/route.ts")
  const payload = responsePayload(route)
  assert.ok(!/volid|volId/.test(payload), "progress response must not include volume id")
  assert.ok(!/storage/.test(payload), "progress response must not include storage")
})

test("PART29 client backups page carries no infra fields anywhere (types included)", () => {
  const page = read("app/client-area/backups/page.tsx")
  assert.ok(!/storageId/.test(page), "backups page must not reference storageId")
  assert.ok(!/storages/.test(page), "backups page must not reference storages")
  assert.ok(!/maxdisk/.test(page), "backups page must not reference maxdisk")
  assert.ok(!/hdd2/.test(page), "backups page must not reference hdd2")
  assert.ok(!/Disk Size|disk size/.test(page), "backups page must not render disk size")
})

test("PART29 vps page drops disk details from the card", () => {
  const page = read("app/client-area/vps/page.tsx")
  assert.ok(!/maxdisk/.test(page), "vps page must not render maxdisk")
  assert.ok(!/hdd2/.test(page), "vps page must not render hdd2")
})

test("PART29 snapshots page carries no node/host infra fields", () => {
  const page = read("app/client-area/snapshots/page.tsx")
  assert.ok(!/\bnode\b/.test(page), "snapshots page must not reference a node field")
  assert.ok(!/hostname of|proxmox host|node name/.test(page), "snapshots page must not describe infra location")
})

test("PART29 admin-side internal fields remain available for operations", () => {
  // The infra stripping is scoped to CUSTOMER surfaces only; ops tools keep
  // the full shape for administration.
  const adminLib = read("lib/backup-storage.ts")
  assert.match(adminLib, /storageId|volid|storages/)
})