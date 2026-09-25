import assert from "node:assert/strict"
import test from "node:test"
import { latestRrdNetworkRate } from "@/lib/compute-node-monitoring"

test("node network telemetry uses the latest finite Proxmox RRD rate", () => {
  assert.deepEqual(latestRrdNetworkRate([
    { time: 100, netin: 1024.4, netout: 2048.6 },
    { time: 160, netin: 86809.18, netout: 437672.03 },
  ]), {
    networkIn: 86809,
    networkOut: 437672,
    recordedAt: 160,
  })
  assert.equal(latestRrdNetworkRate([]), null)
  assert.equal(latestRrdNetworkRate([{ time: 100, netin: "missing", netout: null }]), null)
})
