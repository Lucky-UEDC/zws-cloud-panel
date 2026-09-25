import assert from "node:assert/strict"
import test from "node:test"
import {
  boundedPercent,
  classifyConsoleFailure,
  consoleFailureLabel,
  CONSOLE_STAGE_ORDER,
} from "@/lib/console-contract"

test("console stages preserve the production connection sequence", () => {
  assert.deepEqual(CONSOLE_STAGE_ORDER, [
    "connecting_node",
    "authenticating_session",
    "preparing_display",
    "fetching_framebuffer",
    "ready",
  ])
})

test("console failures map backend and transport errors to stable UI states", () => {
  assert.equal(classifyConsoleFailure("vm_not_running", "Server stopped"), "vm_offline")
  assert.equal(classifyConsoleFailure("console_node_unreachable", "Node unavailable"), "node_offline")
  assert.equal(classifyConsoleFailure("securityfailure", "Authentication failed"), "authentication_failed")
  assert.equal(classifyConsoleFailure("websocket_timeout", "Framebuffer timeout"), "framebuffer_timeout")
  assert.equal(consoleFailureLabel("session_expired"), "Session Expired")
})

test("console telemetry percentages are bounded", () => {
  assert.equal(boundedPercent(-10), 0)
  assert.equal(boundedPercent(45.25), 45.25)
  assert.equal(boundedPercent(130), 100)
  assert.equal(boundedPercent(Number.NaN), 0)
})
