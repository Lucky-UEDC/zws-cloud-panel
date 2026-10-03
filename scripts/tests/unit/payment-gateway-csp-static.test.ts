import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

// Razorpay Checkout renders inside an iframe on https://api.razorpay.com.
// Both nginx (config/nginx/docker.conf) and the Next.js app (next.config.mjs)
// emit a Content-Security-Policy, and when a response carries several CSP
// headers the browser enforces the INTERSECTION of them. A directive that is
// present in only one layer is therefore silently narrowed by the other, which
// is how the Razorpay modal ended up showing Chrome's
// "This content is blocked. Contact the site owner to fix the issue."
// These tests pin the intersection so the two layers cannot drift apart again.

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
const read = (path: string) => readFileSync(`${root}/${path}`, "utf8")

const RAZORPAY_CHECKOUT_FRAME_ORIGIN = "https://api.razorpay.com"
const RAZORPAY_CHECKOUT_SCRIPT_ORIGIN = "https://checkout.razorpay.com"
const RAZORPAY_TELEMETRY_ORIGIN = "https://lumberjack.razorpay.com"

/** Pull every Content-Security-Policy value out of an nginx config. */
function nginxCspValues(conf: string): string[] {
  return [...conf.matchAll(/add_header\s+Content-Security-Policy\s+"([^"]+)"/g)].map((m) => m[1])
}

/** Pull the CSP directives out of an app security-headers array in next.config.mjs. */
function appCspValue(config: string): string {
  const start = config.indexOf('key: "Content-Security-Policy"')
  assert.ok(start !== -1, "next.config.mjs must define a Content-Security-Policy header")
  const end = config.indexOf('].join("; ")', start)
  assert.ok(end !== -1, "expected the CSP header value to be an array joined with '; '")
  const body = config.slice(start, end)
  return [...body.matchAll(/"([^"]+)"/g)]
    .map((m) => m[1])
    .filter((value) => /^[a-z-]+\s/.test(value))
    .join("; ")
}

/** Split a CSP into directive -> origin tokens. */
function directives(policy: string): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const part of policy.split(";")) {
    const tokens = part.trim().split(/\s+/).filter(Boolean)
    if (!tokens.length) continue
    out.set(tokens[0], tokens.slice(1))
  }
  return out
}

/**
 * Resolve the effective source list for a fetch directive the way a browser
 * does when the directive is absent: fall back to default-src.
 */
function effectiveSources(policy: string, directive: string): string[] {
  const d = directives(policy)
  return d.get(directive) || d.get("default-src") || []
}

/** Origins allowed by *every* layer, i.e. the browser's effective intersection. */
function intersect(layers: string[], directive: string): string[] {
  const lists = layers.map((policy) => effectiveSources(policy, directive))
  return lists[0].filter((origin) => lists.every((list) => list.includes(origin)))
}

const nginxConf = read("config/nginx/docker.conf")
const appConfig = read("next.config.mjs")
const layers = [...nginxCspValues(nginxConf), appCspValue(appConfig)]

test("both CSP layers declare an explicit frame-src instead of inheriting default-src", () => {
  assert.ok(layers.length >= 2, "expected nginx and app CSP headers to both be present")
  for (const policy of layers) {
    assert.match(
      policy,
      /(^|;)\s*frame-src\s/,
      "a CSP without frame-src falls back to default-src 'self' and blocks gateway checkout frames",
    )
  }
})

test("the effective frame-src intersection still allows the Razorpay Checkout iframe", () => {
  const allowed = intersect(layers, "frame-src")
  assert.ok(
    allowed.includes(RAZORPAY_CHECKOUT_FRAME_ORIGIN),
    `Razorpay Checkout is framed from ${RAZORPAY_CHECKOUT_FRAME_ORIGIN}; it must survive every CSP layer. Allowed: ${allowed.join(" ")}`,
  )
  assert.ok(allowed.includes(RAZORPAY_CHECKOUT_SCRIPT_ORIGIN))
  // Cashfree's hosted checkout is framed too; keep it working.
  assert.ok(allowed.includes("https://sdk.cashfree.com"))
})

test("the effective script-src intersection allows checkout.js and connect-src allows Razorpay telemetry", () => {
  const scripts = intersect(layers, "script-src")
  assert.ok(scripts.includes(RAZORPAY_CHECKOUT_SCRIPT_ORIGIN), "checkout.js must stay loadable")
  assert.ok(scripts.includes("https://cdn.razorpay.com"))

  const connects = intersect(layers, "connect-src")
  assert.ok(connects.includes(RAZORPAY_TELEMETRY_ORIGIN), `checkout.js calls ${RAZORPAY_TELEMETRY_ORIGIN}`)
})

test("gateway CSP directives never fall back to a wildcard", () => {
  for (const policy of layers) {
    for (const directive of ["default-src", "frame-src", "script-src", "connect-src"]) {
      const sources = effectiveSources(policy, directive)
      assert.ok(sources.length > 0, `${directive} must not be empty`)
      assert.ok(
        !sources.includes("*"),
        `${directive} must list explicit origins rather than *`,
      )
    }
  }
})

test("clickjacking protection is not weakened while unblocking the gateway frames", () => {
  for (const policy of layers) {
    assert.match(policy, /frame-ancestors\s+'none'/)
  }
  assert.match(nginxConf, /add_header X-Frame-Options "DENY" always;/)
  assert.match(appConfig, /key: "X-Frame-Options", value: "DENY"/)
})

test("Razorpay checkout is never routed through the iframed bridge modal", () => {
  // The bridge target is rendered in an iframe by PhonePeBridgeModal, and our own
  // pages are frame-ancestors 'none', so framing them fails. Razorpay must use
  // the Checkout.js modal instead.
  const redirect = read("lib/client/payment-redirect.ts")
  assert.match(
    redirect,
    /if \(gateway === "razorpay"\) \{\s*return razorpayOrderId\?\.startsWith\("order_"\)[\s\S]*?kind: "razorpay-order"/,
    "a Razorpay response carrying an order id must resolve to the Checkout.js modal",
  )
  assert.match(redirect, /new Razorpay\(\{/)
  assert.match(redirect, /checkout\.razorpay\.com\/v1\/checkout\.js/)
})