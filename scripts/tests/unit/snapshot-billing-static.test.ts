import assert from "node:assert/strict"
import test from "node:test"
import {
  calculateSnapshotQuote,
  creditCoversTotal,
  nextSnapshotChargeStatus,
  moneyCents,
} from "@/lib/billing/snapshot-pricing"
import { storageTypeIsSnapshotCapable } from "@/lib/proxmox-snapshots"

test("storage capability: lvmthin is snapshot-capable regardless of format", () => {
  assert.equal(storageTypeIsSnapshotCapable("lvmthin", "raw"), true)
  assert.equal(storageTypeIsSnapshotCapable("lvmthin", "qcow2"), true)
})

test("storage capability: zfspool/zfs/rbd/ceph/btrfs are snapshot-capable", () => {
  for (const type of ["zfspool", "zfs", "rbd", "ceph", "btrfs"]) {
    assert.equal(storageTypeIsSnapshotCapable(type, "raw"), true)
  }
})

test("storage capability: dir storage is only snapshot-capable with qcow2", () => {
  assert.equal(storageTypeIsSnapshotCapable("dir", "raw"), false)
  assert.equal(storageTypeIsSnapshotCapable("dir", "qcow2"), true)
  assert.equal(storageTypeIsSnapshotCapable("dir", "vmdk"), false)
})

test("storage capability: unknown / empty type is not snapshot-capable", () => {
  assert.equal(storageTypeIsSnapshotCapable("", "raw"), false)
  assert.equal(storageTypeIsSnapshotCapable("nfs", "qcow2"), false)
})

test("snapshot quote: 20 + 18% GST = 23.60", () => {
  const quote = calculateSnapshotQuote({ baseAmount: 20, taxPercent: 18 })
  assert.deepEqual(quote, { subtotal: 20, discount: 0, taxableAmount: 20, taxPercent: 18, gst: 3.6, total: 23.6 })
  assert.equal(quote.total, 23.6)
})

test("snapshot quote: fractional GST rounds to paisa", () => {
  const quote = calculateSnapshotQuote({ baseAmount: 5, taxPercent: 12.5 })
  assert.equal(quote.gst, 0.63)
  assert.equal(quote.total, 5.63)
})

test("credit covers total: exactly equal is allowed", () => {
  assert.equal(creditCoversTotal(23.6, 23.6), true)
})

test("credit covers total: one paisa below is rejected", () => {
  assert.equal(creditCoversTotal(23.59, 23.6), false)
})

test("credit covers total: above is allowed", () => {
  assert.equal(creditCoversTotal(4765.18, 23.6), true)
})

test("money is decimal-safe (floating point does not leak)", () => {
  assert.equal(moneyCents(0.1 + 0.2), 0.3)
  assert.equal(moneyCents("23.599999999"), 23.6)
})

test("lifecycle transitions map to correct charge status", () => {
  assert.equal(nextSnapshotChargeStatus("REQUESTED"), "unpaid")
  assert.equal(nextSnapshotChargeStatus("PAYMENT_PENDING"), "unpaid")
  assert.equal(nextSnapshotChargeStatus("PAID"), "paid")
  assert.equal(nextSnapshotChargeStatus("CREATING"), "paid")
  assert.equal(nextSnapshotChargeStatus("COMPLETED", true), "paid")
  assert.equal(nextSnapshotChargeStatus("FAILED", true), "refund_pending")
  assert.equal(nextSnapshotChargeStatus("FAILED", false), "failed")
  assert.equal(nextSnapshotChargeStatus("REFUND_PENDING"), "refund_pending")
  assert.equal(nextSnapshotChargeStatus("REFUNDED"), "refunded")
  assert.equal(nextSnapshotChargeStatus("CANCELLED"), "cancelled")
})

test("snapshot billing stays independent from backup pricing (no shared totals)", () => {
  const snapshot = calculateSnapshotQuote({ baseAmount: 20, taxPercent: 18 })
  const backup = calculateSnapshotQuote({ baseAmount: 149, taxPercent: 18 })
  assert.notEqual(snapshot.total, backup.total)
})