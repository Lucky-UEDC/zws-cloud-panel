import assert from "node:assert/strict"
import test from "node:test"
import { computeConsoleMode } from "@/lib/console-mode"

const graphicalAdapters = [
  { label: "missing", config: {} },
  { label: "default", config: { vga: "default" } },
  { label: "std", config: { vga: "std" } },
  { label: "virtio", config: { vga: "virtio" } },
  { label: "qxl", config: { vga: "qxl" } },
  { label: "vmware", config: { vga: "vmware" } },
  { label: "cirrus", config: { vga: "cirrus" } },
]

for (const adapter of graphicalAdapters) {
  test(`QEMU ${adapter.label} VGA is graphical`, () => {
    const result = computeConsoleMode({ targetKind: "qemu", vmConfig: adapter.config })
    assert.equal(result.switches.canUseVnc, true)
    assert.equal(result.defaultMode, "vnc")
    assert.notEqual(result.mode, "unknown")
  })
}

test("linux guest with both graphical and serial paths defaults to graphical", () => {
  const result = computeConsoleMode({ targetKind: "qemu", vmConfig: { vga: "std", serial0: "socket" }, osName: "Debian 12", osSlug: "debian-12" })
  assert.equal(result.mode, "both")
  assert.equal(result.switches.canUseVnc, true)
  assert.equal(result.switches.canUseSerial, true)
  assert.equal(result.defaultMode, "vnc")
})

test("serial VGA requires a socket serial device", () => {
  const missingSocket = computeConsoleMode({ targetKind: "qemu", vmConfig: { vga: "serial0" } })
  assert.equal(missingSocket.switches.canUseVnc, false)
  assert.equal(missingSocket.switches.canUseSerial, false)
  assert.equal(missingSocket.mode, "unknown")

  const withSocket = computeConsoleMode({ targetKind: "qemu", vmConfig: { vga: "serial0", serial0: "socket" } })
  assert.equal(withSocket.switches.canUseVnc, false)
  assert.equal(withSocket.switches.canUseSerial, true)
  assert.equal(withSocket.defaultMode, "serial")
})

test("none VGA is serial-only when a socket serial device exists", () => {
  const withoutSocket = computeConsoleMode({ targetKind: "qemu", vmConfig: { vga: "none" } })
  assert.equal(withoutSocket.switches.canUseVnc, false)
  assert.equal(withoutSocket.switches.canUseSerial, false)

  const withSocket = computeConsoleMode({ targetKind: "qemu", vmConfig: { vga: "none", serial0: "socket" } })
  assert.equal(withSocket.switches.canUseVnc, false)
  assert.equal(withSocket.switches.canUseSerial, true)
  assert.equal(withSocket.defaultMode, "serial")
})
