import assert from "node:assert/strict"
import { test } from "node:test"
import { mergeGatewayCredentials, nonSecretGatewayCredentialFields, serializePaymentGateway } from "@/lib/payments/payment-gateway-admin"
import { validateGatewayBranding } from "@/lib/payments/payment-gateway-admin-service"

test("gateway branding fields are serialized as non-secret values", () => {
  const row = {
    id: "gw_1",
    code: "razorpay",
    provider: "razorpay",
    name: "Razorpay",
    active: true,
    enabled: true,
    mode: "production",
    priority: 10,
    failsafeEnabled: true,
    lastHealthStatus: "healthy",
    credentials: {
      keyId: "rzp_live_abc123",
      keySecret: "REAL_SECRET",
      webhookSecret: "REAL_WEBHOOK",
      merchantName: "ZWS CLOUD",
      themeColor: "#00C7E8",
      logoUrl: "/uploads/gateway-logos/logo.png",
    },
  }
  const serialized = serializePaymentGateway(row, null, null).credentials
  assert.equal(serialized.keyId, "rzp_live_abc123")
  assert.equal(serialized.merchantName, "ZWS CLOUD")
  assert.equal(serialized.themeColor, "#00C7E8")
  assert.equal(serialized.logoUrl, "/uploads/gateway-logos/logo.png")
  assert.equal(serialized.keySecret, "••••••••")
  assert.equal(serialized.webhookSecret, "••••••••")
})

test("merge skips masked secrets but stores branding and allows clearing branding", () => {
  const existing = {
    code: "razorpay",
    credentials: { keySecret: "REAL_SECRET", keyId: "rzp_keep", merchantName: "OLD NAME" },
  }
  const merged = mergeGatewayCredentials(existing, {
    keySecret: "••••••••",
    keyId: "rzp_keep",
    merchantName: "ZWS CLOUD",
    themeColor: "#00C7E8",
    logoUrl: "/uploads/gateway-logos/logo.png",
  })
  assert.equal(merged.keySecret, "REAL_SECRET")
  assert.equal(merged.keyId, "rzp_keep")
  assert.equal(merged.merchantName, "ZWS CLOUD")
  assert.equal(merged.themeColor, "#00C7E8")
  assert.equal(merged.logoUrl, "/uploads/gateway-logos/logo.png")

  const cleared = mergeGatewayCredentials(existing, { logoUrl: "", themeColor: "" })
  assert.equal(cleared.logoUrl, "")
  assert.equal(cleared.themeColor, "")
  assert.equal(cleared.keySecret, "REAL_SECRET")
})

test("empty secret values never overwrite an existing secret", () => {
  const existing = { code: "razorpay", credentials: { keySecret: "REAL_SECRET", webhookSecret: "REAL_WEBHOOK" } }
  const merged = mergeGatewayCredentials(existing, { keySecret: "", webhookSecret: "•••", merchantName: "ZWS CLOUD" })
  assert.equal(merged.keySecret, "REAL_SECRET")
  assert.equal(merged.webhookSecret, "REAL_WEBHOOK")
  assert.equal(merged.merchantName, "ZWS CLOUD")
})

test("non-secret field lists include branding for every provider", () => {
  for (const gateway of ["razorpay", "cashfree", "phonepe"]) {
    const fields = nonSecretGatewayCredentialFields(gateway)
    for (const branding of ["merchantName", "themeColor", "logo", "logoUrl"]) {
      assert.ok(fields.includes(branding), `${gateway} should expose ${branding} as non-secret`)
    }
  }
  assert.ok(nonSecretGatewayCredentialFields("razorpay").includes("keyId"))
})

test("branding validation rejects malformed colors, paths and oversized names", () => {
  assert.deepEqual(validateGatewayBranding({ themeColor: "not-a-color" })[0]?.field, "themeColor")
  assert.deepEqual(validateGatewayBranding({ themeColor: "blue" })[0]?.field, "themeColor")
  assert.equal(validateGatewayBranding({ themeColor: "#00C7E8" }).length, 0)
  assert.equal(validateGatewayBranding({ themeColor: "#0CE" }).length, 0)
  assert.equal(validateGatewayBranding({ themeColor: "#00C7E833" }).length, 0)
  assert.deepEqual(validateGatewayBranding({ logoUrl: "/etc/passwd" })[0]?.field, "logoUrl")
  assert.equal(validateGatewayBranding({ logoUrl: "/uploads/gateway-logos/logo.png" }).length, 0)
  assert.deepEqual(validateGatewayBranding({ merchantName: "Z".repeat(121) })[0]?.field, "merchantName")
})