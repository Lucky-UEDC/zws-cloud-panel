import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { apiError } from "@/lib/api-response"
import { prisma } from "@/lib/db"
import { CashfreeGatewayError, getCashfreeRuntimeConfig } from "@/lib/cashfree"
import { getBillingPricingSettings, getCustomConfigurationSettings, getSetting, type PaymentSettings } from "@/lib/settings"
import { calculateFixedProductTermQuote } from "@/lib/billing-pricing"
import { requireClientFullAuth, requireSameOriginOrCsrf } from "@/lib/auth/guards"
import { LEGACY_SESSION_COOKIE_NAMES, SESSION_COOKIE_NAMES } from "@/lib/auth/session-cookies"
import { recordCouponRedemption, validateCoupon } from "@/lib/coupons"
import { computeFixedVpsPricing } from "@/lib/fixed-vps-pricing"
import { createInvoiceForOrder } from "@/lib/invoices"
import { invoiceTaxWriteFields } from "@/lib/invoices/tax"
import { enqueueProvisioningJob, enqueueUpgradeJob, encryptSecret, isValidLinuxHostname } from "@/lib/provision"
import { createDomainGatewayPaymentSession } from "@/lib/payment-gateways"
import {
  getGatewayConfigForGateway,
  getGatewayResolutionMetadata,
  isDomainGatewayReady,
  resolvePaymentGateway,
  type ResolvedPaymentGateway,
} from "@/lib/payments/domain-gateway-resolver"
import {
  selectGatewayAttemptPlan,
  validateReturnedGateway,
  gatewayDisplayName,
  type GatewayCandidateSnapshot,
} from "@/lib/payments/gateway-selection"
import { recordGatewayAttempt, safeGatewayError } from "@/lib/payment-attempts"
import { createPanelLog } from "@/lib/panel-log"
import { offerAvailability, snapshotOffer } from "@/lib/offers"
import { getOsFamily } from "@/lib/os-icons"
import { resolveAvailableOsTemplate, resolvedOsTemplateDefaultUsername, serializePublicOperatingSystem } from "@/lib/public-operating-systems"
import {
  calculateCustomConfigurationQuote,
  validateCustomConfigurationInput,
  type CustomConfigurationQuote,
} from "@/lib/custom-configuration-pricing"
import { snapshotStoragePool } from "@/lib/storage-pools"
import { sendVerificationEmail } from "@/lib/email-verification"
import { sendOrderInvoiceNotification } from "@/lib/notifications/service"
import { billingAddressFromCustomer, normalizeBillingAddress, normalizeEmail } from "@/lib/checkout-identity"
import { calculateCanonicalCheckoutPricing } from "@/lib/checkout-pricing"
import { calculatePricing, type PricingCalculation } from "@/lib/payments/calculate-pricing"
import { normalizePremiumIpRequest } from "@/lib/premium-ip-pricing"
import { finalizePaidOrder, handlePaidInvoice } from "@/lib/payment-finalization"
import { getBaseUrl, paymentWebhookUrl } from "@/lib/runtime-site-url"
import { getRegionalPrice } from "@/lib/regional-pricing"
import { allowedGatewayCountries, resolveCheckoutCountry } from "@/lib/payment-country"
import { verifyPricingToken } from "@/lib/pricing-token"
import { assertProductVisibleInCountry } from "@/lib/product-geo"
import { getUsableGateways, type UsableRuntimeGateway } from "@/lib/runtime-payment-resolver"
import { CheckoutTrace, createCheckoutRequestId } from "@/lib/payments/checkout-trace"
import { checkoutTechnicalErrorResponse, classifyCheckoutError, logCheckoutFatal } from "@/lib/payments/checkout-errors"
import { checkoutResumeState, getOrCreateCheckoutSession, getOrCreateCheckoutPayment } from "@/lib/payments/checkout-idempotency"
import { publicGatewayRuntime } from "@/lib/payments/gateway-runtime-service"
import { BULK_DISCOUNT_PERCENT, generateBulkGroupId, generateVmHostnames, hasBulkDiscount, normalizeOrderQuantity } from "@/lib/order-bulk"
import {
  createPendingDedicatedServiceForOrder,
  dedicatedSettingsFromProduct,
  getDedicatedOsOptions,
  markDedicatedPaymentConfirmed,
  sendDedicatedEmail,
} from "@/lib/dedicated"
import { createWalletTopupPayment, normalizeWalletTopupAmount } from "@/lib/wallet-topup"
import { getTaxPolicy } from "@/lib/tax-engine"

const ALLOWED_TERMS = new Set([1, 3, 6, 12, 24, 36])
const paymentCreateSchema = z.object({
  productId: z.string().trim().max(120).optional().nullable(),
  offerSlug: z.string().trim().max(160).optional().nullable(),
  offerId: z.string().trim().max(120).optional().nullable(),
  customConfigId: z.string().trim().max(120).optional().nullable(),
  config: z.record(z.unknown()).optional().nullable(),
  term: z.union([z.number(), z.string()]).optional(),
  amount: z.union([z.number(), z.string()]).optional().nullable(),
  monthlyAmount: z.union([z.number(), z.string()]).optional().nullable(),
  currency: z.string().trim().max(10).optional().nullable(),
  purpose: z.enum(["topup", "order_payment", "upgrade_order", "billable_order"]).optional(),
  customerDetails: z.record(z.unknown()).optional().nullable(),
  couponCode: z.string().trim().max(64).optional().nullable(),
  operatingSystemId: z.string().trim().max(160).optional().nullable(),
  operatingSystemFamily: z.string().trim().max(80).optional().nullable(),
  operatingSystemVersion: z.string().trim().max(80).optional().nullable(),
  region: z.string().trim().max(120).optional().nullable(),
  hostname: z.string().trim().max(253).optional().nullable(),
  quantity: z.union([z.number(), z.string()]).optional().nullable(),
  adminUsername: z.string().trim().max(64).optional().nullable(),
  password: z.string().max(256).optional().nullable(),
  accessMethod: z.string().trim().max(40).optional().nullable(),
  existingOrderId: z.string().trim().max(120).optional().nullable(),
  vpsInstanceId: z.string().trim().max(120).optional().nullable(),
  upgradeCpuCores: z.union([z.number(), z.string()]).optional().nullable(),
  upgradeRamGb: z.union([z.number(), z.string()]).optional().nullable(),
  upgradeDiskGb: z.union([z.number(), z.string()]).optional().nullable(),
  storagePoolId: z.string().trim().max(120).optional().nullable(),
  billingAddress: z.record(z.unknown()).optional().nullable(),
  paymentMethod: z.enum(["wallet", "gateway"]).optional(),
  orderType: z.enum(["dedicated"]).optional(),
  dedicatedOsOptionId: z.string().trim().max(160).optional().nullable(),
  installationNotes: z.string().trim().max(2000).optional().nullable(),
  ipmiRequired: z.boolean().optional(),
  sshPublicKey: z.string().trim().max(8000).optional().nullable(),
  windowsLicenseOption: z.enum(["none", "standard", "datacenter"]).optional(),
  redirectTo: z.string().trim().max(500).optional().nullable(),
  preferredGateway: z.string().trim().max(40).optional().nullable(),
  gateway: z.string().trim().max(40).optional().nullable(),
  idempotencyKey: z.string().trim().max(160).optional().nullable(),
  checkoutSessionId: z.string().trim().max(160).optional().nullable(),
  prepareCheckoutOnly: z.boolean().optional(),
  priceToken: z.string().trim().max(4000).optional().nullable(),
  premiumIps: z.record(z.unknown()).optional().nullable(),
}).passthrough()

function offerMetadata(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {}
}

function allowedOfferFamilies(offer: any) {
  const raw = offerMetadata(offer?.metadata).allowedOsFamilies
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",") : []
  return list.map((item) => getOsFamily(String(item || ""))).filter((item) => item && item !== "linux") as string[]
}

function generateOrderNumber(): string {
  const timestamp = Date.now().toString(36).toUpperCase()
  const random = Math.random().toString(36).substring(2, 6).toUpperCase()
  return `ZWS-${timestamp}-${random}`
}

function invoiceNumberForReference(referenceId: string) {
  return `INV-${referenceId.replace(/[^a-zA-Z0-9-]/g, "").replace(/^-+/, "")}`
}

function sanitizePaymentCreatePayload(body: any) {
  return {
    productId: body?.productId || null,
    customConfigId: body?.customConfigId || null,
    term: body?.term || null,
    amount: body?.amount || null,
    monthlyAmount: body?.monthlyAmount || null,
    currency: body?.currency || null,
    purpose: body?.purpose || null,
    hasConfig: Boolean(body?.config),
    hostname: body?.hostname ? "[provided]" : null,
    adminUsername: body?.adminUsername ? "[provided]" : null,
    hasPassword: Boolean(body?.password),
    hasSshPublicKey: Boolean(body?.sshPublicKey),
    accessMethod: body?.accessMethod || null,
    storagePoolId: body?.storagePoolId || body?.config?.storagePoolId || null,
    hasSshKeyId: Boolean(body?.sshKeyId),
    existingOrderId: body?.existingOrderId || null,
    vpsInstanceId: body?.vpsInstanceId || null,
    customerDetails: body?.customerDetails
      ? {
          email: body.customerDetails.email || null,
          phone: body.customerDetails.phone ? "[provided]" : null,
          name: body.customerDetails.name || null,
        }
      : null,
  }
}

function shouldAutoProvision(params: {
  paymentSettings: PaymentSettings
  paymentMode: string
  walletCovered?: boolean
}) {
  if (params.paymentMode === "mock" && process.env.NODE_ENV !== "production") return true
  if (params.paymentMode === "mock") return false
  if (params.walletCovered) return true
  return Boolean(params.paymentSettings.autoProvisionOnPaymentSuccess)
}

function productionTestPaymentBlocked(paymentMode: string, runtimeMode?: string | null) {
  if (process.env.ZWS_ALLOW_PRODUCTION_TEST_PAYMENTS === "true") return false
  if (!["mock", "bypass"].includes(String(paymentMode || "").toLowerCase())) return false
  return process.env.NODE_ENV === "production" || String(runtimeMode || "").toLowerCase() === "production"
}

function paymentStatusUrl(orderId?: string | null) {
  return orderId ? `/payment/status?order_id=${encodeURIComponent(orderId)}` : null
}

function domainGatewayMode(resolution: ResolvedPaymentGateway | null) {
  if (!resolution) return "sandbox"
  return String(resolution.gatewayConfig?.environment || "sandbox").toLowerCase() === "production"
    ? "production"
    : "sandbox"
}

async function responsePayload(result: unknown) {
  if (result instanceof NextResponse) {
    return await result.clone().json().catch(() => null)
  }
  return (result as any) || null
}

function missingGatewayConfigMessage(resolution: ResolvedPaymentGateway | null) {
  if (!resolution) return "Payment gateway configuration could not be resolved for this domain. Please contact support."
  const defaultGateway = resolution.defaultGateway || resolution.gatewayConfig?.gateway || "none"
  const fallbackGateway = resolution.fallbackGateway || resolution.fallbackGatewayConfig?.gateway || "none"
  return `No usable payment gateway is configured for ${resolution.sourceDomain}. Default gateway: ${defaultGateway}; fallback gateway: ${fallbackGateway}. Please contact support.`
}

function gatewayCandidatePreferenceRank(gateway: any, preferredGateway?: string | null) {
  const preferred = String(preferredGateway || "").trim().toLowerCase()
  const name = String(gateway?.gateway || gateway?.code || "").trim().toLowerCase()
  return preferred && name === preferred ? 0 : 1
}

function gatewayUnavailableMessage(gateway: string) {
  const label = gateway === "razorpay" ? "Razorpay" : gateway === "cashfree" ? "Cashfree" : "PhonePe"
  return `${label} is currently unavailable. Please select another payment method.`
}

function paymentGatewayMatchesSelection(payment: any, explicitGatewaySelected: boolean, preferredGateway: string | null) {
  const paymentGateway = String(payment?.gateway || "").trim().toLowerCase()
  if (!paymentGateway) return !explicitGatewaySelected
  return !explicitGatewaySelected || paymentGateway === String(preferredGateway || "").trim().toLowerCase()
}

async function runtimeGatewayCandidates(request: NextRequest, preferredGateway?: string | null): Promise<any[]> {
  const gateways = await getUsableGateways({ request })
  return gateways
    .map((gateway: UsableRuntimeGateway) => ({
      ...gateway,
      id: null,
      paymentGatewayId: gateway.paymentGatewayId,
      enabled: true,
      displayName: gateway.name,
      credentialsPlain: gateway.credentials,
      returnUrl: gateway.returnUrl,
      webhookUrl: gateway.webhookUrl,
      extraConfig: {},
    }))
    .sort((a: any, b: any) => {
      const preference = gatewayCandidatePreferenceRank(a, preferredGateway) - gatewayCandidatePreferenceRank(b, preferredGateway)
      if (preference !== 0) return preference
      const configuredPriority = Number(a.priority || 100) - Number(b.priority || 100)
      if (configuredPriority !== 0) return configuredPriority
      return String(a.paymentGatewayId || a.gateway).localeCompare(String(b.paymentGatewayId || b.gateway))
    })
}

function configForGateway(resolution: ResolvedPaymentGateway, gateway: string) {
  return getGatewayConfigForGateway(resolution, gateway) || resolution.gatewayConfig
}

function urlsForGateway(resolution: ResolvedPaymentGateway, config: any, merchantOrderId: string, request?: NextRequest) {
  const baseUrl = getBaseUrl(request || null)
  const replace = (value: string) => value.replace(/\{order_id\}/g, encodeURIComponent(merchantOrderId))
  return {
    returnUrl: replace(`${baseUrl}/payment/status?order_id={order_id}`),
    webhookUrl: paymentWebhookUrl(config?.gateway || resolution.gateway, baseUrl),
  }
}

function checkoutSessionUrlsForGateway(
  resolution: ResolvedPaymentGateway | null,
  config: any,
  merchantOrderId: string,
  request?: NextRequest,
) {
  if (resolution) {
    return urlsForGateway(resolution, config, merchantOrderId, request)
  }
  const baseUrl = getBaseUrl(request || null)
  return {
    returnUrl: `${baseUrl}/payment/status?order_id=${encodeURIComponent(merchantOrderId)}`,
    webhookUrl: paymentWebhookUrl(String(config?.gateway || "phonepe"), baseUrl),
  }
}

function modeForGatewayConfig(config: any, resolution: ResolvedPaymentGateway | null) {
  if (!config) {
    return String(resolution?.gatewayConfig?.environment || resolution?.gatewayConfig?.mode || "sandbox").toLowerCase() === "production"
      ? "production"
      : "sandbox"
  }
  return String(config.environment || config.mode || resolution?.gatewayConfig?.environment || "sandbox").toLowerCase() === "production"
    ? "production"
    : "sandbox"
}

function regionSupportedTemplateIds(regions: unknown, regionName: unknown) {
  if (!Array.isArray(regions)) return null
  const wanted = String(regionName || "").trim().toLowerCase()
  if (!wanted) return null
  for (const region of regions) {
    if (!region || typeof region === "string") continue
    const row = region as Record<string, unknown>
    const name = String(row.name || row.slug || "").trim().toLowerCase()
    if (!name || name !== wanted) continue
    const ids = Array.isArray(row.supportedTemplateIds)
      ? row.supportedTemplateIds
      : Array.isArray(row.supportedTemplates)
        ? row.supportedTemplates
        : []
    const normalized = ids.map(String).filter(Boolean)
    return normalized.length ? new Set(normalized) : null
  }
  return null
}

async function logGatewayDecision(input: {
  resolution: ResolvedPaymentGateway | null
  selectedConfig?: any | null
  level?: "info" | "warn" | "error"
  customerId?: string | null
  orderId?: string | null
  paymentAttemptId?: string | null
  message?: string
  extra?: Record<string, unknown>
}) {
  await logPaymentPanelEvent({
    message: input.message || "payment_gateway_resolution_decision",
    level: input.level || "info",
    customerId: input.customerId || null,
    orderId: input.orderId || null,
    metadata: {
      ...getGatewayResolutionMetadata(input.resolution, "card_upi", input.selectedConfig),
      paymentAttemptId: input.paymentAttemptId || null,
      orderId: input.orderId || null,
      ...(input.extra || {}),
    },
  })
}

function paymentInitFailure(message = "Payment could not be started. Please try again.") {
  return NextResponse.json({ success: false, error: message, code: "PAYMENT_INIT_FAILED" }, { status: 502 })
}

function paymentInitPayload(input: {
  order?: any | null
  invoice?: any | null
  payment?: any | null
  gateway: string
  gatewayOrderId?: string | null
  paymentSessionId?: string | null
  paymentUrl?: string | null
  redirectUrl?: string | null
  amount: number
  currency?: string | null
  mode?: string | null
  statusUrl?: string | null
  extra?: Record<string, unknown>
}) {
  const paymentUrl = input.paymentUrl || null
  const redirectUrl = input.redirectUrl || paymentUrl
  const checkoutOptions = (input.extra as any)?.checkoutOptions || (input.extra as any)?.checkout_options || null
  const gatewayResponse = asRecord(input.payment?.gatewayResponse)
  const publicKey = input.gateway === "razorpay"
    ? String((input.extra as any)?.publicKey || (input.extra as any)?.public_key || (input.extra as any)?.keyId || checkoutOptions?.key || "").trim() || null
    : null
  const sessionId = input.paymentSessionId || input.payment?.gatewaySessionId || null
  const razorpayOrderId = input.gateway === "razorpay"
    ? String(checkoutOptions?.order_id || checkoutOptions?.orderId || input.gatewayOrderId || input.payment?.gatewayOrderId || "").trim() || null
    : null
  const razorpayReceipt = input.gateway === "razorpay"
    ? String((input.extra as any)?.receipt || gatewayResponse.receipt || checkoutOptions?.receipt || "").trim() || null
    : null
  const razorpayNotes = input.gateway === "razorpay"
    ? ((input.extra as any)?.notes || gatewayResponse.notes || checkoutOptions?.notes || null)
    : null
  const customer = input.gateway === "razorpay" ? {
    id: input.payment?.customerId || null,
    name: checkoutOptions?.prefill?.name || null,
    email: checkoutOptions?.prefill?.email || null,
    contact: checkoutOptions?.prefill?.contact || null,
  } : undefined
  const invoice = input.gateway === "razorpay" ? {
    id: input.invoice?.id || input.payment?.invoiceId || null,
    number: input.invoice?.invoiceNumber || razorpayReceipt || null,
  } : undefined
  return {
    success: true,
    ok: true,
    orderId: input.order?.id || null,
    orderNumber: input.order?.orderNumber || null,
    invoiceId: input.invoice?.id || input.payment?.invoiceId || null,
    paymentId: input.payment?.id || null,
    gateway: input.gateway,
    publicKey: publicKey || undefined,
    public_key: publicKey || undefined,
    keyId: publicKey || undefined,
    key_id: publicKey || undefined,
    gatewayOrderId: razorpayOrderId || input.gatewayOrderId || input.payment?.gatewayOrderId || null,
    order_id: input.gateway === "razorpay" ? razorpayOrderId || undefined : undefined,
    razorpayOrderId: razorpayOrderId || undefined,
    razorpay_order_id: razorpayOrderId || undefined,
    receipt: razorpayReceipt || undefined,
    notes: razorpayNotes || undefined,
    customer,
    invoice,
    checkoutOptions: input.gateway === "razorpay" ? checkoutOptions || undefined : undefined,
    checkout_options: input.gateway === "razorpay" ? checkoutOptions || undefined : undefined,
    cashfreeOrderId: input.gateway === "cashfree" ? input.gatewayOrderId || input.payment?.gatewayOrderId || null : undefined,
    paymentSessionId: sessionId,
    payment_session_id: sessionId,
    paymentUrl,
    payment_url: paymentUrl,
    checkout_url: paymentUrl,
    redirectUrl,
    amount: Number(input.amount || 0),
    currency: input.currency || "INR",
    mode: input.mode || null,
    statusUrl: input.statusUrl || paymentStatusUrl(input.gatewayOrderId || input.order?.orderNumber) || null,
    ...(input.extra || {}),
  }
}

function logPaymentInitResult(input: {
  orderId?: string | null
  invoiceId?: string | null
  gateway: string
  gatewayOrderId?: string | null
  paymentSessionId?: string | null
  paymentUrl?: string | null
  redirectUrl?: string | null
}) {
  const redirectHost = input.redirectUrl
    ? (() => {
        try {
          return new URL(input.redirectUrl).host
        } catch {
          return "invalid_url"
        }
      })()
    : null
  console.log("[Payments][Create] payment init response", {
    orderId: input.orderId || null,
    invoiceId: input.invoiceId || null,
    gateway: input.gateway,
    gatewayOrderId: input.gatewayOrderId || null,
    hasPaymentSessionId: Boolean(input.paymentSessionId),
    hasPaymentUrl: Boolean(input.paymentUrl || input.redirectUrl),
    redirectHost,
  })
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {}
}

function logPaymentFlowStep(event: string, fields: Record<string, unknown>) {
  console.info("[Payments][Flow]", { event, at: new Date().toISOString(), ...fields })
}

function money(value: unknown) {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : 0
}

function pendingPaymentStatus(status: unknown) {
  return ["created", "pending", "pending_manual", "waiting", "initiated", "started", "initializing", "authorized"].includes(String(status || "").toLowerCase())
}

function terminalRetryablePaymentStatus(status: unknown) {
  return ["failed", "expired", "cancelled", "canceled", "payment_failed"].includes(String(status || "").toLowerCase())
}

async function startCheckoutSessionPayment(input: {
  request: NextRequest
  requestId: string
  trace: CheckoutTrace
  customerId: string
  checkoutSessionId: string
  preferredGateway?: string | null
  explicitGatewaySelected?: boolean
  gatewayResolution: ResolvedPaymentGateway | null
  cashfreeRuntime: ReturnType<typeof getCashfreeRuntimeConfig>
}) {
  logPaymentFlowStep("PAYMENT_FLOW_START", {
    requestId: input.requestId,
    checkoutSessionId: input.checkoutSessionId,
    customerId: input.customerId,
    preferredGateway: input.preferredGateway || null,
    explicitGatewaySelected: Boolean(input.explicitGatewaySelected),
  })
  input.trace.start("checkout_session_lookup", {
    checkoutSessionId: input.checkoutSessionId,
    customerId: input.customerId,
  })
  const checkoutSession = await prisma.checkoutSession.findFirst({
    where: { id: input.checkoutSessionId, customerId: input.customerId },
    include: {
      payments: {
        orderBy: { createdAt: "desc" },
        take: 1,
        include: { paymentAttempts: { orderBy: { createdAt: "desc" }, take: 1 } },
      },
    },
  }).catch((error) => {
    input.trace.fail("checkout_session_lookup", error, { checkoutSessionId: input.checkoutSessionId })
    throw error
  })
  input.trace.pass("checkout_session_lookup", {
    checkoutSessionId: input.checkoutSessionId,
    found: Boolean(checkoutSession),
    invoiceId: checkoutSession?.invoiceId || null,
  })
  if (!checkoutSession) return apiError("checkout_session_not_found", "Checkout session was not found.", 404)
  if (checkoutSession.fulfilledOrderId) return apiError("checkout_session_fulfilled", "Checkout session is already fulfilled.", 409)

  const latestPayment = checkoutSession.payments[0] || null
  const latestAttempt = latestPayment?.paymentAttempts?.[0] || null
  const latestGatewayResponse = asRecord(latestPayment?.gatewayResponse)
  const latestCheckoutOptions = asRecord(latestGatewayResponse.checkout)
  const latestRazorpayOrderReusable = latestPayment?.gateway === "razorpay" &&
    latestGatewayResponse.razorpayFlow === "order" &&
    Boolean(String(latestCheckoutOptions.order_id || latestPayment.gatewayOrderId || "").trim())
  const reusedGatewayMatchesSelection = !input.preferredGateway || String(input.preferredGateway).toLowerCase() === String(latestPayment?.gateway || "").toLowerCase()
  if (latestPayment && pendingPaymentStatus(latestPayment.status) && reusedGatewayMatchesSelection && (latestAttempt?.redirectUrl || latestRazorpayOrderReusable)) {
    const inferredMode = ["production", "sandbox"].includes(String(latestAttempt?.mode || "").toLowerCase())
      ? String(latestAttempt.mode).toLowerCase()
      : domainGatewayMode(input.gatewayResolution)
    const payload = paymentInitPayload({
      invoice: checkoutSession.invoiceId ? { id: checkoutSession.invoiceId } : null,
      payment: latestPayment,
      gateway: latestPayment.gateway,
      gatewayOrderId: latestPayment.gatewayOrderId || latestAttempt.gatewayOrderId || latestAttempt.merchantOrderId,
      paymentSessionId: latestPayment.gatewaySessionId,
      paymentUrl: latestAttempt.redirectUrl,
      redirectUrl: latestAttempt.redirectUrl,
      amount: Number(latestPayment.gatewayAmount || latestPayment.amount || checkoutSession.amount),
      currency: latestPayment.currency || checkoutSession.currency,
      mode: inferredMode,
      statusUrl: paymentStatusUrl(latestAttempt.merchantOrderId || latestPayment.gatewayOrderId || checkoutSession.referenceId),
      extra: {
        checkoutSessionId: checkoutSession.id,
        reusedExistingPayment: true,
        reason: "reused_waiting_checkout_session_payment",
        checkoutOptions: latestPayment.gateway === "razorpay" ? latestCheckoutOptions || null : null,
        brandName: latestPayment.gateway === "razorpay" ? latestGatewayResponse.brandName || null : null,
        brandImage: latestPayment.gateway === "razorpay" ? latestGatewayResponse.brandImage || null : null,
        merchantName: latestPayment.gateway === "razorpay" ? latestGatewayResponse.brandName || null : null,
        razorpayFlow: latestPayment.gateway === "razorpay" ? latestGatewayResponse.razorpayFlow || "order" : undefined,
      },
    })
    input.trace.start("response", { checkoutSessionId: checkoutSession.id, reusedExistingPayment: true })
    input.trace.pass("response", {
      checkoutSessionId: checkoutSession.id,
      paymentId: latestPayment.id,
      gatewayOrderId: payload.gatewayOrderId || null,
      status: 200,
    })
    return NextResponse.json(payload)
  }

  const snapshot = asRecord(checkoutSession.snapshot)
  const orderData = asRecord(snapshot.orderData)
  const invoiceData = asRecord(snapshot.invoiceData)
  const orderMetadata = asRecord(orderData.metadata)
  const checkoutMetadata = asRecord(orderMetadata.checkout)
  const pricingSnapshot = asRecord(orderMetadata.pricingSnapshot)
  const customerDetails = asRecord(orderMetadata.customerDetails)
  const billingAddress = orderMetadata.billingAddress || checkoutMetadata.billingAddress || null
  const referenceBase = checkoutSession.referenceId
  const attemptCount = await prisma.paymentAttempt.count({
    where: { payment: { checkoutSessionId: checkoutSession.id } },
  }).catch(() => 0)
  const merchantOrderId = attemptCount > 0 ? `${referenceBase}-R${attemptCount + 1}` : referenceBase
  const amount = money(checkoutSession.amount)
  const currency = String(checkoutSession.currency || "INR").toUpperCase()
  if (currency !== "INR") return apiError("unsupported_currency", "Unsupported currency", 400)
  if (!amount || amount <= 0) return apiError("invalid_checkout_session_amount", "Checkout session amount is invalid.", 400)

  const existingInvoiceId = checkoutSession.invoiceId
  input.trace.start("invoice_creation", {
    checkoutSessionId: checkoutSession.id,
    invoiceId: existingInvoiceId || null,
    action: existingInvoiceId ? "reuse" : "create",
  })
  let invoice
  try {
    invoice = checkoutSession.invoiceId
      ? await prisma.invoice.findUnique({ where: { id: checkoutSession.invoiceId } })
      : null
    if (!invoice) {
      invoice = await prisma.invoice.create({
        data: {
          invoiceNumber: String(invoiceData.invoiceNumber || invoiceNumberForReference(referenceBase)),
          customerId: checkoutSession.customerId,
          issueDate: new Date(),
          dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          subtotal: money(invoiceData.subtotal ?? pricingSnapshot.subtotal ?? amount),
          ...invoiceTaxWriteFields({
            taxRate: invoiceData.taxRate ?? pricingSnapshot.gstRate ?? pricingSnapshot.taxRate ?? 18,
            taxAmount: invoiceData.taxAmount ?? pricingSnapshot.gst ?? pricingSnapshot.taxAmount ?? 0,
            taxLabel: invoiceData.taxLabel ?? pricingSnapshot.taxLabel ?? "GST",
          }),
          discountAmount: money(invoiceData.discountAmount ?? pricingSnapshot.discount ?? 0),
          totalAmount: amount,
          currency,
          status: "pending",
          type: "service",
          lineItems: [{
            description: String(orderMetadata.productName || orderData.osName || "Cloud instance"),
            quantity: 1,
            unitPrice: money(invoiceData.subtotal ?? orderData.subtotal ?? amount),
            termMonths: Number(orderData.termMonths || 1),
            total: money(invoiceData.subtotal ?? orderData.subtotal ?? amount),
            osName: orderData.osName || null,
          }],
          billingAddress: billingAddress as any,
          metadata: {
            ...asRecord(invoiceData.metadata),
            checkoutSessionId: checkoutSession.id,
            checkoutReference: referenceBase,
            pendingOrderSnapshot: true,
            orderNumber: orderData.orderNumber || null,
            productId: orderData.productId || null,
            offerId: orderData.offerId || null,
            pricingSnapshot,
          },
        },
      })
      await prisma.checkoutSession.update({ where: { id: checkoutSession.id }, data: { invoiceId: invoice.id } })
    }
  } catch (error) {
    input.trace.fail("invoice_creation", error, { checkoutSessionId: checkoutSession.id, invoiceId: existingInvoiceId || null })
    if (error && typeof error === "object" && !(error as any).checkoutStage) (error as any).checkoutStage = "invoice_creation"
    throw error
  }
  input.trace.pass("invoice_creation", {
    checkoutSessionId: checkoutSession.id,
    invoiceId: invoice.id,
    reused: Boolean(existingInvoiceId),
  })

  const allowedGateways = allowedGatewayCountries(String(asRecord(snapshot.regionalPricing).countryCode || pricingSnapshot.countryCode || "IN"))
  input.trace.start("gateway_lookup", { checkoutSessionId: checkoutSession.id, preferredGateway: input.preferredGateway || null })
  const gatewayCandidates = (await runtimeGatewayCandidates(input.request, input.preferredGateway).catch((error) => {
    input.trace.fail("gateway_lookup", error, { checkoutSessionId: checkoutSession.id })
    if (error && typeof error === "object" && !(error as any).checkoutStage) (error as any).checkoutStage = "gateway_lookup"
    throw error
  })).filter((config) => allowedGateways.has(String(config.gateway || "")))
  const gatewayPriority = gatewayCandidates.map((config) => config.gateway) as Array<"razorpay" | "cashfree" | "phonepe">
  input.trace.pass("gateway_lookup", { checkoutSessionId: checkoutSession.id, gatewayPriority })
  logPaymentFlowStep("PAYMENT_FLOW_GATEWAY_SELECTED", {
    requestId: input.requestId,
    checkoutSessionId: checkoutSession.id,
    customerId: checkoutSession.customerId,
    invoiceId: checkoutSession.invoiceId || null,
    preferredGateway: input.preferredGateway || null,
    gatewayPriority,
    candidates: gatewayCandidates.map((config: any) => config.gateway),
  })
  if (!gatewayCandidates.length) {
    return apiError("NO_GATEWAY_AVAILABLE", missingGatewayConfigMessage(input.gatewayResolution), 503)
  }

  const startGateway = async (gateway: "razorpay" | "cashfree" | "phonepe") => {
    const gatewayConfig = gatewayCandidates.find((config) => config.gateway === gateway)
    if (!gatewayConfig) {
      throw new Error(`${gateway} is not configured for this checkout session`)
    }
    const urls = checkoutSessionUrlsForGateway(input.gatewayResolution, gatewayConfig, merchantOrderId, input.request)
    await recordGatewayAttempt({ invoiceId: invoice!.id, gateway, status: "started", requestId: merchantOrderId })
    input.trace.start("payment_creation", {
      checkoutSessionId: checkoutSession.id,
      invoiceId: invoice!.id,
      gateway,
      merchantOrderId,
    })
    input.trace.info("gateway_order_creation", {
      event: "start",
      checkoutSessionId: checkoutSession.id,
      invoiceId: invoice!.id,
      gateway,
      merchantOrderId,
    })
    const checkoutPayment = await getOrCreateCheckoutPayment({
      requestId: input.requestId,
      gateway,
      checkoutSessionId: checkoutSession.id,
      gatewayConfig,
      customerDetails: {
        customerId: checkoutSession.customerId,
        customerEmail: String(customerDetails.email || ""),
        customerPhone: String(customerDetails.phone || ""),
        customerName: String(customerDetails.name || "Client"),
      },
      orderNote: String(orderMetadata.productName || "Cloud instance"),
      returnUrl: urls.returnUrl,
      webhookUrl: urls.webhookUrl,
      invoiceNumber: invoice!.invoiceNumber,
      paymentData: {
        checkoutSessionId: checkoutSession.id,
        invoiceId: invoice!.id,
        customerId: checkoutSession.customerId,
        gateway,
        amount,
        currency,
        status: "created",
        purpose: checkoutSession.purpose,
        walletAppliedAmount: 0,
        gatewayAmount: amount,
        idempotencyKey: `${merchantOrderId}-${gateway}-init`,
      },
      paymentAttemptData: {
        invoiceId: invoice!.id,
        userId: checkoutSession.customerId,
        domainId: input.gatewayResolution?.domainConfig?.id || null,
        gatewayConfigId: gatewayConfig?.id || null,
        gateway,
        sourceDomain: input.gatewayResolution?.sourceDomain || null,
        approvedDomain: input.gatewayResolution?.approvedPaymentDomain || null,
        approvedPaymentDomain: input.gatewayResolution?.approvedPaymentDomain || null,
        merchantOrderId,
        amount,
        currency,
        status: "created",
        mode: modeForGatewayConfig(gatewayConfig, input.gatewayResolution),
        returnUrl: urls.returnUrl,
      },
    })
    const paymentRecord = checkoutPayment.payment
    const paymentAttempt = checkoutPayment.attempt
    const gatewayResponse = asRecord(paymentRecord.gatewayResponse)
    input.trace.pass("payment_creation", {
      checkoutSessionId: checkoutSession.id,
      invoiceId: invoice!.id,
      paymentId: paymentRecord.id,
      paymentAttemptId: paymentAttempt?.id || null,
      gateway,
    })
    input.trace.info("gateway_order_creation", {
      event: "pass",
      checkoutSessionId: checkoutSession.id,
      paymentId: paymentRecord.id,
      gateway,
      gatewayOrderId: paymentRecord.gatewayOrderId || null,
    })
    input.trace.pass("transaction_commit", {
      checkoutSessionId: checkoutSession.id,
      invoiceId: invoice!.id,
      paymentId: paymentRecord.id,
      status: "gateway_redirected",
    })
    await recordGatewayAttempt({ invoiceId: invoice!.id, paymentId: paymentRecord.id, gateway, status: "success", requestId: paymentRecord.gatewayOrderId })
    const payload = paymentInitPayload({
      invoice,
      payment: paymentRecord,
      gateway,
      gatewayOrderId: paymentRecord.gatewayOrderId,
      paymentSessionId: paymentRecord.gatewaySessionId,
      paymentUrl: paymentAttempt?.redirectUrl || null,
      redirectUrl: paymentAttempt?.redirectUrl || null,
      amount,
      currency,
      mode: modeForGatewayConfig(gatewayConfig, input.gatewayResolution),
      statusUrl: paymentStatusUrl(merchantOrderId),
      extra: {
        checkoutSessionId: checkoutSession.id,
        merchantOrderId,
        gatewayAmount: amount,
        walletAppliedAmount: 0,
        verified: false,
        reason: checkoutPayment.reason || "checkout_session_payment_initiated",
        message: checkoutPayment.message || "Opening secure Razorpay checkout...",
        reusedExistingPayment: Boolean(checkoutPayment.reused),
        status: checkoutPayment.status || "gateway_started",
        checkoutOptions: asRecord(gatewayResponse.checkout) || null,
        brandName: gatewayResponse.brandName || null,
        brandImage: gatewayResponse.brandImage || null,
        merchantName: gatewayResponse.brandName || null,
        razorpayFlow: gatewayResponse.razorpayFlow || "order",
      },
    })
    logPaymentInitResult({
      orderId: payload.orderId,
      invoiceId: payload.invoiceId,
      gateway: payload.gateway,
      gatewayOrderId: payload.gatewayOrderId,
      paymentSessionId: payload.paymentSessionId,
      redirectUrl: payload.redirectUrl,
    })
    logPaymentFlowStep("PAYMENT_FLOW_CHECKOUT_SESSION_CREATED", {
      requestId: input.requestId,
      checkoutSessionId: checkoutSession.id,
      paymentId: paymentRecord.id,
      gateway,
      gatewayOrderId: paymentRecord.gatewayOrderId || null,
      paymentSessionId: paymentRecord.gatewaySessionId || null,
      merchantOrderId,
      mode: payload.mode || null,
      reused: Boolean(checkoutPayment.reused),
    })
    input.trace.start("response", {
      checkoutSessionId: checkoutSession.id,
      paymentId: paymentRecord.id,
      gateway,
    })
    input.trace.pass("response", {
      checkoutSessionId: checkoutSession.id,
      invoiceId: invoice!.id,
      paymentId: paymentRecord.id,
      gatewayOrderId: payload.gatewayOrderId || null,
      hasCheckoutOptions: Boolean(payload.checkoutOptions || payload.checkout_options),
      status: 200,
    })
    return NextResponse.json(payload)
  }

  if (input.cashfreeRuntime.paymentMode === "mock") {
    return apiError("razorpay_required", "Razorpay Standard Checkout must be configured before customer payments can be started.", 503)
  }

  // Explicit customer selection ALWAYS controls the gateway. Priority is only
  // used for automatic routing. Failsafe fallback is appended only when the
  // selected gateway's config opts in (failsafeEnabled) AND another gateway is
  // eligible — the selected gateway is still attempted first.
  const attemptPlan = selectGatewayAttemptPlan({
    candidates: gatewayCandidates.map((config) => ({
      gateway: String(config.gateway || "").toLowerCase(),
      priority: Number(config.priority ?? 100),
      failsafeEnabled: Boolean(config.failsafeEnabled),
    })),
    preferredGateway: input.preferredGateway,
    explicitSelection: Boolean(input.explicitGatewaySelected),
  })
  const gatewayAttemptOrder = attemptPlan.attemptOrder
  if (!gatewayAttemptOrder.length) {
    await prisma.checkoutSession.update({ where: { id: checkoutSession.id }, data: { status: "payment_failed" } }).catch(() => undefined)
    const message = input.explicitGatewaySelected && input.preferredGateway
      ? gatewayUnavailableMessage(input.preferredGateway)
      : missingGatewayConfigMessage(input.gatewayResolution)
    return apiError("GATEWAY_UNAVAILABLE", message, 503)
  }

  let lastGatewayError: any = null
  for (const [attemptIndex, gateway] of gatewayAttemptOrder.entries()) {
    const fallbackUsed = attemptIndex > 0
    try {
      const result = await startGateway(gateway as "razorpay" | "cashfree" | "phonepe")
      if (fallbackUsed) {
        const payload = await responsePayload(result)
        // Never silent: log that the requested gateway failed and a fallback
        // (explicitly permitted via failsafeEnabled) was used instead.
        createPanelLog({
          category: "Payment",
          level: "warn",
          message: "payment_gateway_fallback",
          orderId: payload?.orderId || null,
          paymentId: payload?.paymentId || payload?.paymentSessionId || null,
          metadata: {
            requestedGateway: attemptPlan.requestedGateway,
            actualGateway: gateway,
            fallbackUsed,
            checkoutSessionId: checkoutSession.id,
            merchantOrderId,
          },
        }).catch(() => null)
      }
      return result
    } catch (gatewayError: any) {
      lastGatewayError = gatewayError
      input.trace.fail("gateway_order_creation", gatewayError, {
        checkoutSessionId: checkoutSession.id,
        invoiceId: invoice.id,
        gateway,
        requestedGateway: attemptPlan.requestedGateway,
        fallbackUsed,
        merchantOrderId,
      })
      await recordGatewayAttempt({
        invoiceId: invoice.id,
        gateway,
        status: "failed",
        requestId: merchantOrderId,
        ...safeGatewayError(gatewayError),
        metadata: {
          requestedGateway: attemptPlan.requestedGateway,
          actualGateway: gateway,
          fallbackUsed,
          policy: attemptPlan.policy,
          checkoutSessionId: checkoutSession.id,
        },
      })
    }
  }
  await prisma.checkoutSession.update({ where: { id: checkoutSession.id }, data: { status: "payment_failed" } }).catch(() => undefined)
  input.trace.info("response", {
    event: "fail",
    checkoutSessionId: checkoutSession.id,
    invoiceId: invoice.id,
    status: 502,
  })
  const explicitFailureMessage = attemptPlan.policy === "explicit"
    ? `${gatewayDisplayName(attemptPlan.requestedGateway || "")} payment could not be initialized. Please try again or select another payment method.`
    : null
  return apiError("PAYMENT_START_FAILED", explicitFailureMessage || lastGatewayError?.message || "Payment could not be started. Please try again.", 502)
}

function productDisplayName(product: any, customConfigData: any) {
  if (customConfigData) return "Custom Cloud Instance"
  return product?.name || "Custom Cloud Instance"
}

async function logPaymentPanelEvent(input: {
  message: string
  level?: "info" | "warn" | "error"
  customerId?: string | null
  orderId?: string | null
  metadata?: Record<string, unknown>
}) {
  await createPanelLog({
    category: "Payment",
    level: input.level || "warn",
    message: input.message,
    customerId: input.customerId || null,
    orderId: input.orderId || null,
    metadata: input.metadata || {},
    actorType: input.customerId ? "customer" : "system",
    actorId: input.customerId || null,
  })
}

function hasAnyClientAuthCookie(request: NextRequest) {
  return Boolean(
    request.cookies.get(SESSION_COOKIE_NAMES.client)?.value ||
    request.cookies.get(LEGACY_SESSION_COOKIE_NAMES.client)?.value,
  )
}

async function orderRedirectPayload(orderId?: string | null) {
  if (!orderId) {
    return { orderId: null, vpsInstanceId: null, dedicatedServiceId: null, serviceId: null, redirectUrl: null }
  }

  const [vps, dedicated, invoice] = await Promise.all([
    prisma.vpsInstance.findUnique({
      where: { orderId },
      select: { id: true },
    }).catch(() => null),
    prisma.dedicatedService.findUnique({
      where: { orderId },
      select: { id: true },
    }).catch(() => null),
    prisma.invoice.findUnique({
      where: { orderId },
      select: { id: true },
    }).catch(() => null),
  ])
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { orderType: true, metadata: true },
  }).catch(() => null)
  const upgradeVpsId = String((order?.metadata as any)?.upgrade?.vpsInstanceId || "")
  const isDedicated = String(order?.orderType || "").toLowerCase() === "dedicated"
  const serviceId = vps?.id || dedicated?.id || null

  return {
    orderId,
    vpsInstanceId: vps?.id || upgradeVpsId || null,
    dedicatedServiceId: dedicated?.id || null,
    serviceId: serviceId || upgradeVpsId || null,
    redirectUrl: upgradeVpsId
      ? `/client-area/vps/${vps?.id || upgradeVpsId}`
      : dedicated?.id
        ? `/client-area/dedicated/${dedicated.id}`
        : isDedicated
          ? (invoice?.id ? `/client-area/billing/invoices/${invoice.id}` : "/client-area/billing/invoices")
        : orderId
          ? `/client-area/deployments/${orderId}`
        : invoice?.id
          ? `/client-area/billing/invoices/${invoice.id}`
          : "/client-area/billing/invoices",
  }
}

export async function POST(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") || createCheckoutRequestId()
  const trace = new CheckoutTrace(requestId)
  let currentCheckoutStage = "request"
  try {
    trace.start("request", {
      method: request.method,
      url: request.url,
      idempotencyKey: request.headers.get("idempotency-key") || null,
    })
	    const paymentSettings = await getSetting<PaymentSettings>("payment_settings")
	    const customConfigurationSettings = await getCustomConfigurationSettings()
	    const rawBody = await request.json().catch(() => ({}))
    const parsedBody = paymentCreateSchema.safeParse(rawBody)
    if (!parsedBody.success) {
      return apiError("invalid_request", "Invalid payment request payload.", 400)
    }
	    const body = parsedBody.data
    trace.pass("request", {
      payload: sanitizePaymentCreatePayload(body),
      preferredGateway: body.preferredGateway || body.gateway || null,
      checkoutSessionId: body.checkoutSessionId || null,
      purpose: body.purpose || null,
    })
    const requestedCurrency = String(body.currency || "").trim().toUpperCase()
    if (requestedCurrency && requestedCurrency !== "INR") {
      return apiError("unsupported_currency", "Unsupported currency", 400)
    }
	    console.log("[Payments][Create] request payload", sanitizePaymentCreatePayload(body))
	    const requestedGateway = String(body.preferredGateway || body.gateway || "").toLowerCase() || null
    if (requestedGateway && !["razorpay", "phonepe", "cashfree"].includes(requestedGateway)) {
      return apiError("unsupported_gateway", "Unsupported payment gateway", 400)
    }
    // Explicit customer selection wins over priority. When absent, automatic
    // routing uses configured gateway priority ONLY (no implicit razorpay bias).
    const preferredGateway = requestedGateway
    const explicitGatewaySelected = Boolean(requestedGateway)
    currentCheckoutStage = "gateway_lookup"
    trace.start("gateway_lookup", { preferredGateway })
	    const gatewayResolution = await resolvePaymentGateway({ request, preferredGateway }).catch((error) => {
	      console.warn("[Payments][Create] domain gateway resolver failed", { code: error?.code || null, message: error?.message || null })
      trace.fail("gateway_lookup", error)
	      return null
	    })
    trace.pass("gateway_lookup", {
      sourceDomain: gatewayResolution?.sourceDomain || null,
      gateway: gatewayResolution?.gateway || null,
      fallbackGateway: gatewayResolution?.fallbackGatewayConfig?.gateway || null,
      gatewayReady: gatewayResolution ? isDomainGatewayReady(gatewayResolution.gatewayConfig) : false,
    })
	    const paymentBypassEnabled = process.env.NODE_ENV !== "production" && Boolean(paymentSettings.paymentBypassTestMode)
	    const activePaymentMode = paymentBypassEnabled ? "mock" : domainGatewayMode(gatewayResolution)
	    const cashfreeRuntime = getCashfreeRuntimeConfig({
	      appId: gatewayResolution?.gateway === "cashfree" && isDomainGatewayReady(gatewayResolution.gatewayConfig) ? "configured" : undefined,
	      secretKey: gatewayResolution?.gateway === "cashfree" && isDomainGatewayReady(gatewayResolution.gatewayConfig) ? "configured" : undefined,
	      mode: activePaymentMode as any,
	    })
	    console.log("[Payments][Create] gateway config", {
	      paymentMode: cashfreeRuntime.paymentMode,
	      mode: cashfreeRuntime.mode,
	      endpoint: cashfreeRuntime.apiBaseUrl,
	      sourceDomain: gatewayResolution?.sourceDomain || null,
	      approvedPaymentDomain: gatewayResolution?.approvedPaymentDomain || null,
	      gateway: gatewayResolution?.gateway || null,
	      fallbackGateway: gatewayResolution?.fallbackGatewayConfig?.gateway || null,
	      requireManualVerification: paymentSettings.requireManualVerification,
	      gatewayConfigured: gatewayResolution ? isDomainGatewayReady(gatewayResolution.gatewayConfig) : false,
	    })
    currentCheckoutStage = "customer_lookup"
    trace.start("customer_lookup", { auth: "requireClientFullAuth" })
    const auth = await requireClientFullAuth(request)
    if (!auth.ok) {
      if (!hasAnyClientAuthCookie(request)) {
        return apiError("login_required", "Please login to continue with purchase.", 401)
      }
      return auth.response
    }
    const origin = await requireSameOriginOrCsrf(request)
    if (!origin.ok) return origin.response
    const client = {
      sub: auth.session.userId,
      email: auth.session.email,
      name: auth.session.name || auth.session.email,
    }
    const requestedCheckoutSessionId = String(body.checkoutSessionId || "").trim()
    if (requestedCheckoutSessionId) {
      currentCheckoutStage = "checkout_session_payment"
      return await startCheckoutSessionPayment({
        request,
        requestId,
        trace,
        customerId: String(client.sub),
        checkoutSessionId: requestedCheckoutSessionId,
        preferredGateway,
        explicitGatewaySelected,
        gatewayResolution,
        cashfreeRuntime,
      })
    }
    const {
      productId,
      offerSlug: requestedOfferSlug,
      offerId: requestedOfferId,
      customConfigId: requestedCustomConfigId,
      config,
      term = 1,
      amount: topupAmount,
      monthlyAmount,
      purpose: inputPurpose,
      customerDetails: bodyCustomerDetails,
      couponCode: requestedCouponCode,
      operatingSystemId: requestedOperatingSystemId,
      operatingSystemFamily: requestedOperatingSystemFamily,
      operatingSystemVersion: requestedOperatingSystemVersion,
      region: requestedRegion,
      hostname: requestedHostname,
      quantity: requestedQuantity,
      adminUsername: requestedAdminUsername,
      password: requestedPassword,
      accessMethod: requestedAccessMethod,
      existingOrderId,
      vpsInstanceId,
      upgradeCpuCores,
      upgradeRamGb,
      upgradeDiskGb,
      storagePoolId: requestedStoragePoolId,
      paymentMethod: requestedPaymentMethod,
      orderType: requestedOrderType,
      dedicatedOsOptionId: requestedDedicatedOsOptionId,
      installationNotes: requestedInstallationNotes,
      ipmiRequired: requestedIpmiRequired,
      sshPublicKey: requestedDedicatedSshPublicKey,
      windowsLicenseOption: requestedWindowsLicenseOption,
      idempotencyKey: requestedIdempotencyKey,
      premiumIps: requestedPremiumIps,
      priceToken: requestedPriceToken,
    } = body
    const parsedTerm = Number(term)
    const quantity = normalizeOrderQuantity(requestedQuantity)
    const isOfferCheckout = Boolean(requestedOfferSlug || requestedOfferId)
    const paymentMethod = String(requestedPaymentMethod || "").toLowerCase()
    const isDedicatedCheckout = String(requestedOrderType || "").toLowerCase() === "dedicated"
    const checkoutConfig = config as any
    const premiumIpRequest = normalizePremiumIpRequest(requestedPremiumIps || checkoutConfig?.premiumIps || {})

    let customerDetails = bodyCustomerDetails as any
    const dbCustomer = client?.sub
      ? await prisma.customer.findUnique({ where: { id: String(client.sub) } })
      : null
    trace.pass("customer_lookup", {
      customerId: dbCustomer?.id || client.sub || null,
      hasCustomer: Boolean(dbCustomer),
      emailVerified: Boolean(dbCustomer?.emailVerifiedAt),
    })
    const detectedCountry = await resolveCheckoutCountry({ request, customer: dbCustomer })
    if (!customerDetails && client?.sub && client?.email) {
      customerDetails = {
        email: normalizeEmail(client.email),
        phone: String(dbCustomer?.phone || ""),
        name: String(client.name || dbCustomer?.name || "Client"),
      }
    }

    if (!client?.sub || !client?.email) {
      return apiError("login_required", "Please login to continue with purchase.", 401)
    }

    if (!ALLOWED_TERMS.has(parsedTerm)) {
      return apiError("invalid_term", "Invalid billing term. Supported terms: 1, 3, 6, 12, 24, 36.", 400)
    }

    if (!customerDetails?.email || !customerDetails?.phone) {
      return apiError("profile_incomplete", "Please complete your profile email and phone number before payment.", 400)
    }
    const normalizedSubmittedEmail = normalizeEmail(customerDetails.email)
    const normalizedSessionEmail = normalizeEmail(dbCustomer?.email || client.email)
    if (normalizedSubmittedEmail !== normalizedSessionEmail) {
      return apiError("email_mismatch", "Checkout email must match the signed-in account. Please login with this email instead.", 409)
    }

    const purpose = String(inputPurpose || (topupAmount ? "topup" : "order_payment"))
    if (!["topup", "order_payment", "upgrade_order", "billable_order"].includes(purpose)) {
      return apiError("invalid_purpose", "Unsupported payment purpose", 400)
    }
    if (purpose === "topup") {
      const amount = normalizeWalletTopupAmount(topupAmount)
      if (amount === null || amount <= 0) return apiError("invalid_price", "Invalid top-up amount", 400)
      return NextResponse.json(await createWalletTopupPayment({
        request,
        customer: {
          id: String(client.sub),
          email: normalizedSessionEmail,
          name: String(customerDetails.name || dbCustomer?.name || "Client"),
          phone: String(customerDetails.phone || dbCustomer?.phone || ""),
        },
        amount,
      }))
    }
    if (purpose === "order_payment") {
      if (!dbCustomer?.emailVerifiedAt) {
        await sendVerificationEmail({
          userId: String(client.sub),
          redirectTo: String(body.redirectTo || request.headers.get("referer") || "/checkout"),
          reason: "checkout",
        }).catch(() => null)
      }
      if (!["wallet", "gateway"].includes(paymentMethod)) {
        return apiError("payment_method_required", "Choose PhonePe or Cashfree before payment.", 400)
      }
      if (detectedCountry !== "IN" && paymentMethod === "wallet") {
        return apiError("international_wallet_unavailable", "Checkout supports PhonePe or Cashfree payment only.", 400)
      }
    }
    const normalizedIdempotencyKey = String(requestedIdempotencyKey || "").trim()
    const walletOrderIdempotencyKey = (purpose === "order_payment" || purpose === "billable_order") && paymentMethod === "wallet" && normalizedIdempotencyKey
      ? normalizedIdempotencyKey
      : null
    if (walletOrderIdempotencyKey) {
      const existingWalletPayment = await prisma.payment.findUnique({
        where: { idempotencyKey: walletOrderIdempotencyKey },
        include: { order: true, invoice: true },
      }).catch(() => null)
      if (existingWalletPayment && ["completed", "paid", "success"].includes(String(existingWalletPayment.status || "").toLowerCase())) {
        const redirect = await orderRedirectPayload(existingWalletPayment.orderId)
        return NextResponse.json({
          ...redirect,
          success: true,
          ok: true,
          status: "paid",
          paymentMethod: "wallet",
          gateway: "wallet",
          orderId: existingWalletPayment.orderId,
          orderNumber: existingWalletPayment.order?.orderNumber || null,
          invoiceId: existingWalletPayment.invoiceId,
          paymentId: existingWalletPayment.id,
          amount: Number(existingWalletPayment.amount || 0),
          currency: existingWalletPayment.currency,
          walletAppliedAmount: Number(existingWalletPayment.walletAppliedAmount || existingWalletPayment.amount || 0),
          gatewayAmount: 0,
          verified: true,
          reason: "wallet_payment_reused",
        })
      }
    }
    let selectedOperatingSystem: any = null
    let requestedOsFamily: string | null = null
    let requestedOsVersion: string | null = null
    if (purpose === "order_payment") {
      if (!isDedicatedCheckout && !requestedOperatingSystemId && !requestedOfferSlug && !requestedOfferId) {
        return apiError("operating_system_required", "Select an operating system before payment.", 400)
      }
      const groupedOsId = String(requestedOperatingSystemId || "")
      const groupedParts = groupedOsId.includes(":") ? groupedOsId.split(":") : []
      requestedOsFamily = requestedOperatingSystemFamily ? String(requestedOperatingSystemFamily) : groupedParts[0] || null
      requestedOsVersion = requestedOperatingSystemVersion ? String(requestedOperatingSystemVersion) : groupedParts.slice(1).join(":") || null
      selectedOperatingSystem = await resolveAvailableOsTemplate({
        id: requestedOperatingSystemId ? String(requestedOperatingSystemId) : null,
        family: requestedOsFamily,
        version: requestedOsVersion,
      })
      console.info("[Payments][Create] os_template_validation", {
        requestedOperatingSystemId: requestedOperatingSystemId ? String(requestedOperatingSystemId) : null,
        requestedOsFamily,
        requestedOsVersion,
        resolvedTemplateId: selectedOperatingSystem?.id || null,
        proxmoxVmid: selectedOperatingSystem?.proxmoxVmid || null,
        proxmoxNodeId: selectedOperatingSystem?.proxmoxNodeId || null,
        region: String(requestedRegion || ""),
      })
      if (!isDedicatedCheckout && requestedOperatingSystemId && !selectedOperatingSystem?.proxmoxVmid) {
        return apiError("invalid_operating_system", "Selected operating system is not available for provisioning.", 400)
      }
      if (selectedOperatingSystem) {
        const publicOs = serializePublicOperatingSystem(selectedOperatingSystem)
        requestedOsFamily = String(publicOs.family || requestedOsFamily || selectedOperatingSystem.osFamily || getOsFamily(selectedOperatingSystem))
        requestedOsVersion = String(publicOs.version || requestedOsVersion || selectedOperatingSystem.osVersion || selectedOperatingSystem.name || "")
      }
    }

    if (purpose === "order_payment" && !isDedicatedCheckout) {
      const hostname = String(requestedHostname || "").trim()
      const accessMethod = String(requestedAccessMethod || "PASSWORD").toUpperCase()
      const password = String(requestedPassword || "")
      if (!hostname) {
        return apiError("hostname_required", "Enter an instance name before payment.", 400)
      }
      if (!isValidLinuxHostname(hostname)) {
        return apiError("invalid_hostname", "Instance name must use valid hostname characters.", 400)
      }
      if (accessMethod !== "PASSWORD") {
        return apiError("invalid_access_method", "Checkout currently supports password login only.", 400)
      }
      if (password.length < 8) {
        return apiError("invalid_password", "Password must be at least 8 characters.", 400)
      }
    }
    if (purpose === "order_payment" && isDedicatedCheckout) {
      const hostname = String(requestedHostname || "").trim()
      if (!isValidLinuxHostname(hostname)) {
        return apiError("invalid_hostname", "Instance name must use valid hostname characters.", 400)
      }
      if (!String(requestedDedicatedOsOptionId || "").trim()) {
        return apiError("dedicated_os_required", "Select an operating system or platform before payment.", 400)
      }
    }

    const billingAddressSnapshot = purpose === "order_payment"
      ? normalizeBillingAddress({
        ...billingAddressFromCustomer(dbCustomer),
          name: customerDetails.name || dbCustomer?.name || null,
          email: normalizedSessionEmail,
          phone: customerDetails.phone || dbCustomer?.phone || null,
        })
      : null

    currentCheckoutStage = "product_lookup"
    trace.start("product_lookup", {
      productId: productId || null,
      offerSlug: requestedOfferSlug || null,
      offerId: requestedOfferId || null,
      customConfigId: requestedCustomConfigId || null,
      purpose,
    })
    let unitPrice = 0
    let productData = null
    let offerData: any = null
    let offerSnapshot: any = null
    let fixedPricingMeta: ReturnType<typeof computeFixedVpsPricing> | null = null
    let customPricingMeta: CustomConfigurationQuote | null = null
    let customConfigData = null
    let selectedStoragePool: any = null
    let dedicatedOsOption: any = null
    let dedicatedSettings: ReturnType<typeof dedicatedSettingsFromProduct> | null = null
    let customConfigId = requestedCustomConfigId ? String(requestedCustomConfigId) : undefined
    let pendingCustomConfig:
      | {
          cpuCores: number
          ramGb: number
          disks: unknown[]
          bandwidthTb: number
          termMonths: number
          monthlyPrice: number
          totalPrice: number
        }
      | null = null

    // Get pricing from product or custom config, unless this is wallet top-up.
    if (purpose === "topup") {
      const parsed = Number(topupAmount)
      if (!Number.isFinite(parsed) || parsed <= 0) {
        return apiError("invalid_price", "Invalid top-up amount", 400)
      }
      unitPrice = parsed
    } else if ((purpose === "upgrade_order" || purpose === "billable_order") && existingOrderId) {
      const existingOrder = await prisma.order.findFirst({
        where: { id: String(existingOrderId), customerId: String(client.sub) },
      })
      if (!existingOrder) {
        return apiError("upgrade_order_missing", purpose === "upgrade_order" ? "Upgrade order not found." : "Billable order not found.", 404)
      }
      unitPrice = purpose === "upgrade_order"
        ? Number(existingOrder.unitPrice || existingOrder.totalAmount)
        : Number(existingOrder.totalAmount || existingOrder.payableAmount || existingOrder.unitPrice)
      if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
        return apiError("invalid_price", "Order amount is invalid.", 400)
      }
    } else if (requestedOfferSlug || requestedOfferId) {
      currentCheckoutStage = "plan_lookup"
      trace.start("plan_lookup", { offerSlug: requestedOfferSlug || null, offerId: requestedOfferId || null, termMonths: parsedTerm })
      if (!requestedOperatingSystemId) return apiError("operating_system_required", "Select an operating system before payment.", 400)
      const offer = await prisma.offer.findFirst({
        where: requestedOfferId ? { id: String(requestedOfferId) } : { slug: String(requestedOfferSlug || "") },
        include: { osTemplate: { include: { proxmoxNode: true } }, nodeClassRef: true, proxmoxNodeStoragePool: true },
      })
      if (!offer) return apiError("offer_unavailable", "Offer is no longer available.", 404)
      const availability = offerAvailability(offer)
      if (!availability.available) return apiError("offer_unavailable", availability.reason || "Offer is no longer available.", 400)
      const allowedTerms = Array.isArray(offer.billingTermsAllowed) ? offer.billingTermsAllowed.map((item) => Number(item)) : [1]
      if (!allowedTerms.includes(parsedTerm)) return apiError("invalid_term", "This offer is not available for the selected billing term.", 400)
      if (!selectedOperatingSystem) return apiError("invalid_operating_system", "Selected operating system is not available for provisioning.", 400)
      const families = allowedOfferFamilies(offer)
      if (families.length && !families.includes(String(serializePublicOperatingSystem(selectedOperatingSystem).family || getOsFamily(selectedOperatingSystem)))) {
        return apiError("invalid_operating_system", "Selected operating system is not available for this offer.", 400)
      }
      offerData = offer
      offerSnapshot = snapshotOffer(offer)
      trace.pass("plan_lookup", { offerId: offer.id, productId: offer.productId || null, termMonths: parsedTerm })
      unitPrice = Number(offer.offerMonthlyPrice || 0)
      if (!Number.isFinite(unitPrice) || unitPrice <= 0) return apiError("invalid_price", "Offer price is invalid.", 400)
      pendingCustomConfig = {
        cpuCores: Number(offer.vcpu),
        ramGb: Number(offer.ramGb),
        disks: [{ type: offer.storageTier || "nvme", sizeGb: Number(offer.storageGb), label: "Offer storage" }],
        bandwidthTb: Number(offer.bandwidthTb || 1),
        termMonths: parsedTerm,
        monthlyPrice: unitPrice,
        totalPrice: Number((unitPrice * parsedTerm).toFixed(2)),
      }
    } else if (productId) {
      console.log("[Payments][Create] validating product", {
        productId,
        term: parsedTerm,
        customerId: client.sub,
      })
      const product = await prisma.product.findUnique({
        where: { id: productId },
      })

      if (!product) {
        await logPaymentPanelEvent({
          message: "checkout_invalid_product",
          level: "warn",
          customerId: String(client.sub),
          metadata: { productId: String(productId), purpose },
        })
        return apiError("product_missing", "Selected cloud instance is unavailable.", 404)
      }

      try {
        assertProductVisibleInCountry(product, detectedCountry)
      } catch (error: any) {
        await logPaymentPanelEvent({
          message: "product_geo_restricted_checkout_rejected",
          level: "warn",
          customerId: String(client.sub),
          metadata: { productId: String(productId), country: detectedCountry, code: error?.code || null },
        })
        return apiError(error?.code || "product_geo_restricted", error?.message || "This product is not available in your country.", error?.status || 403)
      }

      productData = product
      const productType = String(product.type || "").toLowerCase()
      trace.pass("product_lookup", { productId: product.id, productType, termMonths: parsedTerm })

      if (isDedicatedCheckout && productType !== "dedicated") {
        return apiError("invalid_product_type", "Selected product is not a dedicated server.", 400)
      }
      if (!isDedicatedCheckout && productType === "dedicated") {
        return apiError("invalid_product_type", "Dedicated servers must use the dedicated checkout.", 400)
      }

      if (productType === "dedicated") {
        dedicatedSettings = dedicatedSettingsFromProduct(product)
        if (!dedicatedSettings.purchaseEnabled) {
          return apiError("dedicated_purchase_disabled", "Online booking is disabled for this dedicated server. Please contact sales.", 403)
        }
        const osOptions = await getDedicatedOsOptions(product)
        dedicatedOsOption = osOptions.find((option) => option.id === String(requestedDedicatedOsOptionId) || option.slug === String(requestedDedicatedOsOptionId))
        if (!dedicatedOsOption) {
          return apiError("dedicated_os_unavailable", "Selected operating system or platform is unavailable.", 400)
        }
        const billingSettings = await getBillingPricingSettings()
        unitPrice = calculateFixedProductTermQuote({ product, term: parsedTerm as any, settings: billingSettings }).selectedMonthlyPrice
        if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
          return apiError("invalid_price", "Invalid dedicated server pricing. Please contact support.", 400)
        }
      } else if (productType === "configurable") {
        if (!customConfigurationSettings.enableCustomConfiguration) {
          await logPaymentPanelEvent({
            message: "checkout_custom_config_disabled",
            level: "warn",
            customerId: String(client.sub),
            metadata: { productId: product.id, purpose },
          })
          return apiError("custom_config_disabled", "Custom configuration is disabled.", 403)
        }
        if (!config || typeof config !== "object") {
          return apiError("invalid_request", "Custom configuration details are required.", 400)
        }

        const selectedConfigStoragePoolId = String((config as { storagePoolId?: string })?.storagePoolId || requestedStoragePoolId || "")
        const configDisks = (config as { disks?: unknown[] }).disks
        const disks =
          Array.isArray(configDisks) && configDisks.length > 0
            ? configDisks.map((disk: any, index) => ({
                type: String(disk?.type || product.storageType || "nvme").toLowerCase() === "ssd" ? "ssd" : "nvme",
                sizeGb: Number(disk?.sizeGb || disk?.size || 0),
                label: String(disk?.label || `Disk ${index + 1}`),
              }))
            : [{ type: product.storageType || "nvme", sizeGb: Number(product.storageGb || customConfigurationSettings.defaultStorageGb), label: "Disk 1" }]
        if (selectedConfigStoragePoolId) {
          selectedStoragePool = await prisma.nodeStoragePoolConfig.findFirst({
            where: { id: selectedConfigStoragePoolId, enabled: true, missingFromProxmox: false, isCustomerSelectable: true, isUpgradeOnly: false },
          })
          if (!selectedStoragePool) return apiError("storage_pool_unavailable", "Selected storage pool is unavailable.", 400)
          disks[0].type = String(selectedStoragePool.storageType || disks[0].type || "nvme").toLowerCase()
        }
        const customInput = {
          cpuCores: Number((config as { cpu?: number }).cpu || product.cpuCores || customConfigurationSettings.defaultVcpu),
          ramGb: Number((config as { ram?: number }).ram || product.ramGb || customConfigurationSettings.defaultRamGb),
          disks,
          storageGb: disks.reduce((sum, disk) => sum + Number(disk.sizeGb || 0), 0),
          storageType: disks[0]?.type === "ssd" ? "ssd" as const : "nvme" as const,
          bandwidthTb: Number((config as { bandwidth?: number }).bandwidth || product.bandwidthTb || customConfigurationSettings.defaultBandwidthTb),
          term: parsedTerm as any,
        }
        const validation = validateCustomConfigurationInput(customInput, customConfigurationSettings)
        if (!validation.valid) {
          return apiError("invalid_custom_configuration", validation.errors.join(" "), 400)
        }
        customPricingMeta = calculateCustomConfigurationQuote(customInput, customConfigurationSettings)
        unitPrice = customPricingMeta.discountedMonthly
        if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
          return apiError("invalid_price", "Invalid custom configuration pricing", 400)
        }
        pendingCustomConfig = {
          cpuCores: customInput.cpuCores,
          ramGb: customInput.ramGb,
          disks,
          bandwidthTb: customInput.bandwidthTb,
          termMonths: parsedTerm,
          monthlyPrice: customPricingMeta.discountedMonthly,
          totalPrice: customPricingMeta.subtotal,
        }
      } else {
        const billingSettings = await getBillingPricingSettings()
        unitPrice = calculateFixedProductTermQuote({ product, term: parsedTerm as any, settings: billingSettings }).selectedMonthlyPrice
        if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
          return apiError("invalid_price", "Invalid product pricing. Please contact support.", 400)
        }
        if (product.requiredStoragePoolId || product.defaultStoragePoolId) {
          selectedStoragePool = await prisma.nodeStoragePoolConfig.findFirst({
            where: { id: String(product.requiredStoragePoolId || product.defaultStoragePoolId), enabled: true, missingFromProxmox: false },
          })
        }
      }

      if (productType === "fixed_vps") {
        fixedPricingMeta = computeFixedVpsPricing({
          cpuCores: product.cpuCores,
          ramGb: product.ramGb,
          storageGb: product.storageGb,
          storageType: product.storageType,
          bandwidthTb: Number(product.bandwidthTb),
          specs: (product.specs as Record<string, unknown>) || null,
          productMonthlyPrice: Number(product.price1m),
        })
      }
    } else if (customConfigId) {
      if (!customConfigurationSettings.enableCustomConfiguration) {
        await logPaymentPanelEvent({
          message: "checkout_custom_config_disabled",
          level: "warn",
          customerId: String(client.sub),
          metadata: { customConfigId, purpose },
        })
        return apiError("custom_config_disabled", "Custom configuration is disabled.", 403)
      }
      const config = await prisma.customConfig.findUnique({
        where: { id: customConfigId },
      })

      if (!config) {
        return apiError("invalid_request", "Custom configuration not found", 404)
      }

      unitPrice = Number(config.monthlyPrice)
      if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
        return apiError("invalid_price", "Invalid custom configuration pricing", 400)
      }
      customConfigData = config
      trace.pass("product_lookup", { customConfigId, source: "custom_configuration", termMonths: parsedTerm })
    } else {
      return apiError("product_missing", "Product ID, offer, or custom configuration is required", 400)
    }

    // Calculate amounts
    const dedicatedWindowsSelected = isDedicatedCheckout && /windows/i.test(`${dedicatedOsOption?.family || ""} ${dedicatedOsOption?.familyLabel || ""} ${dedicatedOsOption?.name || ""}`)
    const windowsLicenseOption = dedicatedWindowsSelected && ["standard", "datacenter"].includes(String(requestedWindowsLicenseOption || "none"))
      ? String(requestedWindowsLicenseOption)
      : "none"
    const windowsSetupFee = dedicatedWindowsSelected && windowsLicenseOption !== "none" ? 500 : 0
    const windowsLicenseFee = dedicatedWindowsSelected && windowsLicenseOption !== "none" ? 800 : 0
    const dedicatedSetupFee = isDedicatedCheckout && dedicatedSettings ? Number(dedicatedSettings.setupFee || 0) + windowsSetupFee + windowsLicenseFee : 0
    let subtotal = purpose === "topup" || purpose === "billable_order" ? unitPrice : purpose === "upgrade_order" ? unitPrice : unitPrice * parsedTerm + dedicatedSetupFee
    const taxPolicy = getTaxPolicy(detectedCountry)
    const gstRate = detectedCountry === "IN"
      ? offerData ? Number(offerData.gstPercent || 18) : customPricingMeta ? Number(customPricingMeta.taxRate || 18) : 18
      : Number(taxPolicy.percent || 0)
    const gstEnabled = purpose === "upgrade_order" || purpose === "billable_order"
      ? false
      : detectedCountry === "IN"
        ? offerData ? offerData.gstEnabled !== false : true
        : taxPolicy.enabled
    let pricingSnapshot: PricingCalculation = calculatePricing({ subtotal, discount: 0, gstRate, gstEnabled })
    let taxAmount = pricingSnapshot.gst
    let originalAmount = purpose === "topup" || purpose === "upgrade_order" || purpose === "billable_order" ? subtotal : pricingSnapshot.total
    if (!Number.isFinite(originalAmount) || originalAmount <= 0) {
      return apiError("invalid_price", "Calculated total amount is invalid", 400)
    }
    let discountAmount = 0
    let couponCode: string | null = null
    let couponId: string | null = null
    let payableAmount = originalAmount
    if (purpose !== "topup" && requestedCouponCode) {
      const preDiscountGst = calculatePricing({ subtotal, discount: 0, gstRate, gstEnabled }).gst
      const couponResult = await validateCoupon({
        code: String(requestedCouponCode),
        customerId: String(client.sub),
        productId: productId ? String(productId) : null,
        termMonths: parsedTerm,
        subtotal,
        taxAmount: preDiscountGst,
      })
      if (!couponResult.valid) {
        return apiError("invalid_coupon", couponResult.reason || "Invalid coupon", 400)
      }
      discountAmount = couponResult.discountAmount
      couponCode = couponResult.code || null
      couponId = couponResult.couponId || null
    }
    pricingSnapshot = calculatePricing({ subtotal, discount: discountAmount, gstRate, gstEnabled })
    taxAmount = pricingSnapshot.gst
    payableAmount = purpose === "topup" || purpose === "upgrade_order" || purpose === "billable_order" ? subtotal : pricingSnapshot.total

    const canonicalPricing = purpose === "order_payment" && productId && !isOfferCheckout && !isDedicatedCheckout
      ? await calculateCanonicalCheckoutPricing({
          productId: String(productId),
          countryCode: detectedCountry,
          customerId: String(client.sub),
          term: parsedTerm,
          couponCode: requestedCouponCode ? String(requestedCouponCode) : null,
          customCpu: checkoutConfig?.cpu,
          customRamGb: checkoutConfig?.ram,
          customStorageGb: Array.isArray(checkoutConfig?.disks) ? checkoutConfig.disks.reduce((sum: number, disk: any) => sum + Number(disk?.sizeGb || disk?.size || 0), 0) : checkoutConfig?.storage,
          customBandwidthTb: checkoutConfig?.bandwidth,
	          diskTier: checkoutConfig?.diskTier,
	          storagePoolId: checkoutConfig?.storagePoolId || requestedStoragePoolId,
	          premiumIps: premiumIpRequest,
	          config: checkoutConfig && typeof checkoutConfig === "object" ? checkoutConfig : null,
	        })
      : null
    if (canonicalPricing) {
      unitPrice = canonicalPricing.quote.monthly.total
      subtotal = canonicalPricing.subtotal
      taxAmount = canonicalPricing.taxAmount
      originalAmount = canonicalPricing.originalAmount
      discountAmount = canonicalPricing.discountAmount
      payableAmount = canonicalPricing.payableToday
      pricingSnapshot = canonicalPricing.pricing
      couponCode = canonicalPricing.couponCode
      couponId = canonicalPricing.couponId
      fixedPricingMeta = canonicalPricing.fixedPricingMeta
      customPricingMeta = canonicalPricing.customPricingMeta
    }
    const requestedProvisionRegion = String(requestedRegion || (config as any)?.region || "").trim()
    const supportedTemplateIds = regionSupportedTemplateIds(productData?.regions, requestedProvisionRegion)
    if (selectedOperatingSystem?.id && supportedTemplateIds && !supportedTemplateIds.has(String(selectedOperatingSystem.id))) {
      console.warn("[Payments][Create] os_region_template_mismatch", {
        requestedProvisionRegion,
        selectedTemplateId: selectedOperatingSystem.id,
        supportedTemplateCount: supportedTemplateIds.size,
      })
      return apiError("invalid_operating_system", "Selected operating system is not available in this region.", 400)
    }
    let verifiedRegionalToken: Awaited<ReturnType<typeof verifyPricingToken>> | null = null
    if (purpose === "order_payment" && productId && !isOfferCheckout && !isDedicatedCheckout) {
      if (!requestedPriceToken) {
        await logPaymentPanelEvent({
          message: "pricing_token_missing",
          level: "warn",
          customerId: String(client.sub),
          metadata: { productId: String(productId), term: parsedTerm },
        })
        return apiError("pricing_token_required", "Refresh checkout pricing before payment.", 409)
      }
      verifiedRegionalToken = await verifyPricingToken(requestedPriceToken, {
        product: String(productId),
        term: parsedTerm,
        customerId: String(client.sub),
        country: detectedCountry,
        consume: true,
      }).catch(async (error) => {
        await logPaymentPanelEvent({
          message: "pricing_token_rejected",
          level: "warn",
          customerId: String(client.sub),
          metadata: { productId: String(productId), term: parsedTerm, code: error?.code || null, message: error?.message || null },
        })
        throw error
      })
    }
    if (purpose === "order_payment" && !isDedicatedCheckout && quantity > 1) {
      subtotal = Number((subtotal * quantity).toFixed(2))
      discountAmount = Number((discountAmount * quantity).toFixed(2))
      pricingSnapshot = calculatePricing({ subtotal, discount: discountAmount, gstRate, gstEnabled })
      taxAmount = pricingSnapshot.gst
      originalAmount = pricingSnapshot.total
      payableAmount = pricingSnapshot.total
    }
    const automaticBulkDiscount = purpose === "order_payment" && !isDedicatedCheckout && hasBulkDiscount(quantity)
      ? Number((subtotal * (BULK_DISCOUNT_PERCENT / 100)).toFixed(2))
      : 0
    if (automaticBulkDiscount > 0) {
      discountAmount = Number((discountAmount + automaticBulkDiscount).toFixed(2))
      pricingSnapshot = calculatePricing({ subtotal, discount: discountAmount, gstRate, gstEnabled })
      taxAmount = pricingSnapshot.gst
      originalAmount = pricingSnapshot.subtotal + pricingSnapshot.gst
      payableAmount = pricingSnapshot.total
    }
    console.info("[Payments][Create] pricing calculation", {
      customerId: String(client.sub),
      productId: productId || offerData?.productId || null,
      countryCode: detectedCountry,
      quantity,
      subtotal,
      discountAmount,
      gstRate,
      gstEnabled,
      taxAmount,
      payableAmount,
      taxLabel: taxPolicy.label,
    })
    const regionalPricing = await getRegionalPrice({
      amountInr: payableAmount,
      countryCode: detectedCountry,
      term: parsedTerm,
      product: productId || offerData?.id || null,
      customerId: String(client.sub),
      context: { purpose, productId: productId || null, offerId: offerData?.id || null },
    }).catch(() => null)
    if (verifiedRegionalToken && regionalPricing) {
      const expectedPrice = Number(regionalPricing.displayAmount || 0)
      const tokenPrice = Number(verifiedRegionalToken.price || 0)
      if (verifiedRegionalToken.currency !== regionalPricing.displayCurrency || Math.abs(tokenPrice - expectedPrice) > 0.01) {
        await logPaymentPanelEvent({
          message: "pricing_token_amount_or_currency_mismatch",
          level: "warn",
          customerId: String(client.sub),
          metadata: {
            productId: String(productId),
            term: parsedTerm,
            tokenCurrency: verifiedRegionalToken.currency,
            expectedCurrency: regionalPricing.displayCurrency,
          },
        })
        return apiError("pricing_token_mismatch", "Pricing changed. Refresh checkout and try again.", 409)
      }
    }
    const chargedCurrency = "INR"
    const chargedAmount = payableAmount
    const localCurrencyPayment = false
    const currencyDecimals = 2
    const localMoney = (value: unknown) => Number(Number(value || 0).toFixed(currencyDecimals))
    const taxLabel = taxPolicy.label

    // Create or get customer
    let customer = dbCustomer
    if (!customer) return apiError("login_required", "Please login to continue with purchase.", 401)

    if (isOfferCheckout) {
      await logPaymentPanelEvent({
        message: "offer_checkout_started",
        level: "info",
        customerId: customer.id,
        metadata: {
          offerSlug: requestedOfferSlug ? String(requestedOfferSlug) : null,
          offerId: requestedOfferId ? String(requestedOfferId) : offerData?.id || null,
          term: parsedTerm,
          amount: payableAmount,
        },
      })
    }

    if (pendingCustomConfig && !(purpose === "order_payment" && paymentMethod === "gateway")) {
      const createdConfig = await prisma.customConfig.create({
        data: {
          customerId: customer.id,
          cpuCores: pendingCustomConfig.cpuCores,
          ramGb: pendingCustomConfig.ramGb,
          disks: pendingCustomConfig.disks as any,
          bandwidthTb: pendingCustomConfig.bandwidthTb,
          termMonths: pendingCustomConfig.termMonths,
          monthlyPrice: pendingCustomConfig.monthlyPrice,
          totalPrice: pendingCustomConfig.totalPrice,
          status: "draft",
        },
      })
      customConfigId = createdConfig.id
      customConfigData = createdConfig
    }

    let orderAccessMethod = "PASSWORD"
    let orderSshKeyId: string | null = null
    let orderSshPublicKey: string | null = null
    let orderPasswordEncrypted: string | null = null

    if (purpose === "order_payment" && !isDedicatedCheckout) {
      orderAccessMethod = "PASSWORD"
      orderSshKeyId = null
      orderSshPublicKey = null
      orderPasswordEncrypted = encryptSecret(String(requestedPassword || ""))
    }

    // Create order record for order payments; topups don't require order linkage.
    const orderNumber = generateOrderNumber()
    const selectedStorageDiskGb = productData
      ? Number(productData.storageGb || 0)
      : pendingCustomConfig
        ? (pendingCustomConfig.disks as any[]).reduce((sum, disk) => sum + Number(disk?.sizeGb || 0), 0)
        : 0
    if (purpose === "order_payment" && paymentMethod === "gateway") {
      const allowedGateways = allowedGatewayCountries(detectedCountry)
      const gatewayCandidates = (await runtimeGatewayCandidates(request, preferredGateway))
        .filter((config) => allowedGateways.has(String(config.gateway || "")))
      const gatewayPriority = gatewayCandidates.map((config) => config.gateway) as Array<"razorpay" | "cashfree" | "phonepe">
      if (!gatewayCandidates.length) {
        await logGatewayDecision({
          resolution: gatewayResolution,
          level: "warn",
          customerId: customer.id,
          message: "payment_config_missing",
          extra: {
            purpose,
            message: missingGatewayConfigMessage(gatewayResolution),
          },
        })
        return apiError("NO_GATEWAY_AVAILABLE", missingGatewayConfigMessage(gatewayResolution), 503)
      }
      console.info("[Payments][Create] INR gateway candidates", {
        customerId: customer.id,
        productId: productId || offerData?.productId || null,
        offerId: offerData?.id || null,
        amount: chargedAmount,
        currency: chargedCurrency,
        gatewayPriority,
      })

      const referenceId = `CHK-${orderNumber.replace(/^ZWS-/, "")}`
      const existingSession = normalizedIdempotencyKey
        ? await prisma.checkoutSession.findUnique({
            where: { idempotencyKey: normalizedIdempotencyKey },
            include: { payments: { orderBy: { createdAt: "desc" }, take: 1 } },
          }).catch(() => null)
        : null
      if (existingSession) {
        if (body.prepareCheckoutOnly && !existingSession.payments.length) {
          return NextResponse.json({
            success: true,
            ok: true,
            checkoutSessionId: existingSession.id,
            referenceId: existingSession.referenceId,
            amount: Number(existingSession.amount),
            currency: existingSession.currency,
            status: existingSession.status,
            gateway: existingSession.gateway,
            reason: "reused_pending_checkout_session",
          })
        }
        const existingPayment = existingSession.payments[0]
        const existingAttempt = existingPayment ? await prisma.paymentAttempt.findFirst({ where: { paymentId: existingPayment.id }, orderBy: { createdAt: "desc" } }).catch(() => null) : null
        if (existingPayment && ["created", "pending", "pending_manual"].includes(String(existingPayment.status || "").toLowerCase()) && paymentGatewayMatchesSelection(existingPayment, explicitGatewaySelected, preferredGateway)) {
          return NextResponse.json(paymentInitPayload({
            payment: existingPayment,
            gateway: existingPayment.gateway,
            gatewayOrderId: existingPayment.gatewayOrderId || existingSession.referenceId,
            paymentSessionId: existingPayment.gatewaySessionId,
            paymentUrl: existingAttempt?.redirectUrl || null,
            redirectUrl: existingAttempt?.redirectUrl || null,
            amount: Number(existingPayment.gatewayAmount || existingPayment.amount || existingSession.amount),
            currency: existingPayment.currency,
            mode: existingAttempt?.mode || domainGatewayMode(gatewayResolution),
            statusUrl: paymentStatusUrl(existingPayment.gatewayOrderId || existingSession.referenceId),
            extra: {
              checkoutSessionId: existingSession.id,
              reusedExistingPayment: true,
              gatewayAmount: Number(existingPayment.gatewayAmount || existingPayment.amount || existingSession.amount),
              walletAppliedAmount: 0,
              verified: false,
              reason: "reused_pending_checkout_session",
            },
          }))
        }
        if (!paymentGatewayMatchesSelection(existingPayment, explicitGatewaySelected, preferredGateway)) {
          console.info("[Payments][Create] existing session payment gateway does not match selection; ignoring reuse", {
            referenceId,
            existingGateway: existingPayment?.gateway || null,
            preferredGateway: explicitGatewaySelected ? preferredGateway : null,
          })
          await logGatewayDecision({
            resolution: gatewayResolution,
            level: "warn",
            customerId: customer.id,
            message: "existing_session_gateway_mismatch",
            extra: {
              checkoutSessionId: existingSession.id,
              existingGateway: existingPayment?.gateway || null,
              selectedGateway: explicitGatewaySelected ? preferredGateway : preferredGateway,
            },
          })
        }
      }
      const existingIntent = normalizedIdempotencyKey
        ? await prisma.checkoutIntent.findUnique({
            where: { idempotencyKey: normalizedIdempotencyKey },
            include: { payments: { orderBy: { createdAt: "desc" }, take: 1 } },
          }).catch(() => null)
        : null
      if (existingIntent) {
        const existingPayment = existingIntent.payments[0]
        const existingInvoice = existingIntent.invoiceId ? await prisma.invoice.findUnique({ where: { id: existingIntent.invoiceId } }).catch(() => null) : null
        const existingAttempt = existingPayment ? await prisma.paymentAttempt.findFirst({ where: { paymentId: existingPayment.id }, orderBy: { createdAt: "desc" } }).catch(() => null) : null
        if (existingPayment && ["created", "pending", "pending_manual"].includes(String(existingPayment.status || "").toLowerCase()) && paymentGatewayMatchesSelection(existingPayment, explicitGatewaySelected, preferredGateway)) {
          return NextResponse.json(paymentInitPayload({
            invoice: existingInvoice,
            payment: existingPayment,
            gateway: existingPayment.gateway,
            gatewayOrderId: existingPayment.gatewayOrderId || existingIntent.referenceId,
            paymentSessionId: existingPayment.gatewaySessionId,
            paymentUrl: existingAttempt?.redirectUrl || null,
            redirectUrl: existingAttempt?.redirectUrl || null,
            amount: Number(existingPayment.gatewayAmount || existingPayment.amount || existingIntent.amount),
            currency: existingPayment.currency,
            mode: existingAttempt?.mode || domainGatewayMode(gatewayResolution),
            statusUrl: paymentStatusUrl(existingPayment.gatewayOrderId || existingIntent.referenceId),
            extra: {
              checkoutIntentId: existingIntent.id,
              reusedExistingPayment: true,
              gatewayAmount: Number(existingPayment.gatewayAmount || existingPayment.amount || existingIntent.amount),
              walletAppliedAmount: 0,
              verified: false,
              reason: "reused_legacy_checkout_intent",
            },
          }))
        }
      }

      const productName = offerData?.name || productDisplayName(productData, customConfigData || pendingCustomConfig)
      const generatedHostnames = purpose === "order_payment" && !isDedicatedCheckout
        ? generateVmHostnames({
            planName: productName,
            customerName: customer.name || customer.email,
            quantity,
            startAt: 1,
          })
        : [String(requestedHostname || "").trim()]
      const primaryHostname = String(requestedHostname || "").trim() || generatedHostnames[0] || ""
      const bulkGroupId = quantity > 1 ? generateBulkGroupId("checkout") : null
      const perOrderSubtotal = Number((subtotal / Math.max(1, quantity)).toFixed(2))
      const perOrderDiscount = Number((discountAmount / Math.max(1, quantity)).toFixed(2))
      const perOrderTax = Number((taxAmount / Math.max(1, quantity)).toFixed(2))
      const perOrderTotal = Number((payableAmount / Math.max(1, quantity)).toFixed(2))
      const localizedSubtotal = localMoney(subtotal)
      const localizedDiscount = localMoney(discountAmount)
      const localizedTax = localMoney(taxAmount)
      const localizedOriginalAmount = localMoney(originalAmount)
      const localizedPerOrderSubtotal = localMoney(perOrderSubtotal)
      const localizedPerOrderDiscount = localMoney(perOrderDiscount)
      const localizedPerOrderTax = localMoney(perOrderTax)
      const localizedPerOrderTotal = localMoney(perOrderTotal)
      const orderData = {
        orderNumber,
        customerId: customer.id,
        productId: productId || offerData?.productId || undefined,
        offerId: offerData?.id || undefined,
        customConfigId: customConfigId || undefined,
        orderType: isDedicatedCheckout ? "dedicated" : offerData ? "offer" : undefined,
        offerSnapshot: offerSnapshot || undefined,
        nodeClassId: offerData?.nodeClassId || undefined,
        nodeClassSnapshot: offerData?.nodeClassRef ? {
          id: offerData.nodeClassRef.id,
          name: offerData.nodeClassRef.name,
          slug: offerData.nodeClassRef.slug,
          publicLabel: offerData.nodeClassRef.publicLabel,
        } : undefined,
        storagePoolId: offerData?.storagePoolId || selectedStoragePool?.id || undefined,
        storagePoolSnapshot: offerData?.proxmoxNodeStoragePool ? {
          id: offerData.proxmoxNodeStoragePool.id,
          storageId: offerData.proxmoxNodeStoragePool.storageId,
          displayName: offerData.proxmoxNodeStoragePool.displayName || offerData.proxmoxNodeStoragePool.storageId,
          premium: offerData.proxmoxNodeStoragePool.premium,
          allowNewPurchase: offerData.proxmoxNodeStoragePool.allowNewPurchase,
          pricePerGbMonthly: Number(offerData.proxmoxNodeStoragePool.pricePerGbMonthly || 0),
        } : selectedStoragePool ? snapshotStoragePool(selectedStoragePool, { includedDiskGb: selectedStorageDiskGb, diskGb: selectedStorageDiskGb }) as any : undefined,
        termMonths: parsedTerm,
        unitPrice: localMoney(unitPrice),
        quantity: 1,
        subtotal: localizedPerOrderSubtotal,
        taxAmount: localizedPerOrderTax,
        discountAmount: localizedPerOrderDiscount,
        totalAmount: localizedPerOrderTotal,
        originalAmount: Number((localizedPerOrderSubtotal + localizedPerOrderTax).toFixed(currencyDecimals)),
        finalAmount: localizedPerOrderTotal,
        payableAmount: localizedPerOrderTotal,
        couponCode,
        couponId,
        operatingSystemId: isDedicatedCheckout ? null : selectedOperatingSystem?.id || null,
        requestedOsFamily: isDedicatedCheckout ? dedicatedOsOption?.family || null : requestedOsFamily,
        requestedOsVersion: isDedicatedCheckout ? dedicatedOsOption?.version || null : requestedOsVersion,
        osName: isDedicatedCheckout ? dedicatedOsOption?.name || null : selectedOperatingSystem?.name || null,
        templateVmid: null,
        proxmoxNodeId: null,
        gatewayMode: cashfreeRuntime.paymentMode,
        currency: chargedCurrency,
        status: "pending_payment",
        hostname: primaryHostname,
        adminUsername: !isDedicatedCheckout ? String(requestedAdminUsername || resolvedOsTemplateDefaultUsername(selectedOperatingSystem) || "root") : null,
        passwordEncrypted: orderPasswordEncrypted,
        accessMethod: isDedicatedCheckout ? "MANUAL_DELIVERY" : orderAccessMethod,
        sshKeyId: orderSshKeyId,
        sshPublicKey: orderSshPublicKey,
        metadata: {
          productName,
          offer: offerSnapshot,
          checkout: {
            productId: productId || offerData?.productId || null,
            offerId: offerData?.id || null,
            offerSlug: offerData?.slug || requestedOfferSlug || null,
            term: parsedTerm,
            selectedOsTemplateId: selectedOperatingSystem?.id || null,
            selectedOsFamily: requestedOsFamily,
            selectedOsVersion: requestedOsVersion,
            hostname: primaryHostname,
            quantity,
            bulkGroupId,
            generatedHostnames,
            username: !isDedicatedCheckout ? String(requestedAdminUsername || resolvedOsTemplateDefaultUsername(selectedOperatingSystem) || "root") : null,
            billingAddress: billingAddressSnapshot || null,
            customerId: customer.id,
            customConfigId: customConfigId || null,
            source: offerData ? "offer_checkout" : isDedicatedCheckout ? "dedicated_checkout" : "checkout",
          },
          customerDetails: { ...customerDetails, email: normalizedSessionEmail },
          billingAddress: billingAddressSnapshot || undefined,
          pricingSnapshot: {
            baseCurrency: "INR",
            baseSubtotalInr: pricingSnapshot.subtotal,
            baseDiscountInr: pricingSnapshot.discount,
            baseTaxInr: pricingSnapshot.gst,
            baseTotalInr: pricingSnapshot.total,
            subtotal: localizedSubtotal,
            discount: localizedDiscount,
            discountPercent: pricingSnapshot.discountPercent,
            taxableAmount: localMoney(pricingSnapshot.taxableAmount),
            gst: localizedTax,
            total: chargedAmount,
            bulkDiscountAmount: localMoney(automaticBulkDiscount),
            baseBulkDiscountInr: automaticBulkDiscount,
            bulkDiscountPercent: hasBulkDiscount(quantity) ? BULK_DISCOUNT_PERCENT : 0,
            regional: regionalPricing,
            countryCode: regionalPricing?.countryCode || detectedCountry,
            locale: request.headers.get("x-zws-locale") || null,
            currency: chargedCurrency,
            exchangeRate: regionalPricing?.exchangeRate || null,
            taxLabel,
          },
          premiumIps: canonicalPricing?.premiumIps || (premiumIpRequest.enabled ? premiumIpRequest.pricing : null),
          configuration: config || null,
          operatingSystem: selectedOperatingSystem
            ? {
                id: selectedOperatingSystem.id,
                name: selectedOperatingSystem.name,
                proxmoxVmid: selectedOperatingSystem.proxmoxVmid,
                proxmoxNodeId: selectedOperatingSystem.proxmoxNodeId,
                family: requestedOsFamily,
                version: requestedOsVersion,
              }
            : null,
          dedicated: isDedicatedCheckout
            ? {
                osOptionId: dedicatedOsOption?.id || null,
                osFamily: dedicatedOsOption?.familyLabel || dedicatedOsOption?.family || null,
                osName: dedicatedOsOption?.name || null,
                deliverySlaHours: dedicatedSettings?.deliverySlaHours || 72,
                estimatedDeliveryLabel: `Delivery within ${dedicatedSettings?.deliverySlaHours || 72} hours after payment confirmation`,
                installationNotes: String(requestedInstallationNotes || "").trim() || null,
                sshKeyProvided: Boolean(String(requestedDedicatedSshPublicKey || "").trim()),
                ipmiRequired: Boolean(requestedIpmiRequired),
                setupFee: dedicatedSetupFee,
                baseSetupFee: Number(dedicatedSettings?.setupFee || 0),
                windowsLicenseOption,
                windowsSetupFee,
                windowsLicenseFee,
                bandwidthLabel: dedicatedSettings?.bandwidthLabel || null,
                location: dedicatedSettings?.location || null,
              }
            : null,
          pricingMeta: fixedPricingMeta || customPricingMeta || null,
        } as any,
      }

      currentCheckoutStage = "checkout_session_creation"
      trace.start("checkout_session_creation", { referenceId, customerId: customer.id, amount: chargedAmount, currency: chargedCurrency })
      const reservedAt = new Date()
      const reservationExpiresAt = new Date(reservedAt.getTime() + 15 * 60 * 1000)
      const checkoutSessionResult = await getOrCreateCheckoutSession({
        requestId,
        data: {
          referenceId,
          idempotencyKey: normalizedIdempotencyKey || null,
          customerId: customer.id,
          status: "pending_payment",
          purpose,
          gateway: gatewayPriority[0] || "razorpay",
          amount: chargedAmount,
          currency: chargedCurrency,
          reservedAt,
          reservationExpiresAt,
          snapshot: JSON.parse(JSON.stringify({
            regionalPricing,
            orderData,
            pendingCustomConfig,
            invoiceData: {
              invoiceNumber: invoiceNumberForReference(referenceId),
              subtotal: localizedSubtotal,
              taxAmount: localizedTax,
              discountAmount: localizedDiscount,
              totalAmount: chargedAmount,
              currency: chargedCurrency,
              taxRate: gstRate,
              taxLabel,
            },
            bulkOrders: generatedHostnames.map((hostname, index) => ({
              ...orderData,
              orderNumber: index === 0 ? orderData.orderNumber : generateOrderNumber(),
              hostname,
              metadata: {
                ...(orderData.metadata as any),
                checkout: {
                  ...((orderData.metadata as any).checkout || {}),
                  hostname,
                },
                bulkGroupId,
                bulkIndex: index + 1,
                bulkQuantity: quantity,
                generatedHostname: hostname,
              },
            })),
            dedicatedService: isDedicatedCheckout ? {
              productId: productData?.id || null,
              osOptionId: dedicatedOsOption?.id || null,
              hostname: String(requestedHostname || "").trim(),
              installationNotes: String(requestedInstallationNotes || "").trim() || null,
              sshPublicKey: String(requestedDedicatedSshPublicKey || "").trim() || null,
              ipmiRequired: Boolean(requestedIpmiRequired),
              deliverySlaHours: dedicatedSettings?.deliverySlaHours || 72,
              windowsLicenseOption,
              windowsSetupFee,
              windowsLicenseFee,
            } : null,
          })) as any,
        },
      })
      const checkoutSession = checkoutSessionResult.session
      trace.pass("checkout_session_creation", {
        checkoutSessionId: checkoutSession.id,
        referenceId: checkoutSession.referenceId,
        invoiceId: checkoutSession.invoiceId || null,
        reused: checkoutSessionResult.reused,
      })
      if (checkoutSessionResult.reused) {
        const state = checkoutResumeState(checkoutSession)
        const existingPayment = checkoutSession.payments?.[0] || null
        const existingAttempt = existingPayment?.paymentAttempts?.[0] || null
        if (existingPayment && !paymentGatewayMatchesSelection(existingPayment, explicitGatewaySelected, preferredGateway)) {
          console.info("[Payments][Create] reused checkout session payment gateway does not match selection; starting fresh payment", {
            checkoutSessionId: checkoutSession.id,
            existingGateway: existingPayment.gateway || null,
            preferredGateway,
            explicitGatewaySelected,
          })
          await logPaymentPanelEvent({
            message: "proper_session_gateway_mismatch",
            level: "info",
            customerId: customer.id,
            metadata: {
              checkoutSessionId: checkoutSession.id,
              existingGateway: existingPayment.gateway || null,
              selectedGateway: preferredGateway,
              explicitGatewaySelected,
            },
          })
          currentCheckoutStage = "checkout_session_payment"
          return await startCheckoutSessionPayment({
            request,
            requestId,
            trace,
            customerId: customer.id,
            checkoutSessionId: checkoutSession.id,
            preferredGateway,
            explicitGatewaySelected,
            gatewayResolution,
            cashfreeRuntime,
          })
        }
        if (existingPayment && terminalRetryablePaymentStatus(existingPayment.status)) {
          currentCheckoutStage = "checkout_session_payment"
          return await startCheckoutSessionPayment({
            request,
            requestId,
            trace,
            customerId: customer.id,
            checkoutSessionId: checkoutSession.id,
            preferredGateway,
            explicitGatewaySelected,
            gatewayResolution,
            cashfreeRuntime,
          })
        }
        if (body.prepareCheckoutOnly || !existingPayment) {
          trace.start("response", { checkoutSessionId: checkoutSession.id, reused: true })
          trace.pass("response", { checkoutSessionId: checkoutSession.id, status: 200, reason: state.reason })
          return NextResponse.json({
            success: true,
            ok: true,
            checkoutSessionId: checkoutSession.id,
            referenceId: checkoutSession.referenceId,
            amount: Number(checkoutSession.amount),
            currency: checkoutSession.currency,
            gateway: checkoutSession.gateway || "razorpay",
            invoiceId: checkoutSession.invoiceId || null,
            paymentId: existingPayment?.id || null,
            ...state,
          })
        }
        const gatewayResponse = asRecord(existingPayment.gatewayResponse)
        const payload = paymentInitPayload({
          payment: existingPayment,
          gateway: existingPayment.gateway,
          gatewayOrderId: existingPayment.gatewayOrderId || checkoutSession.referenceId,
          paymentSessionId: existingPayment.gatewaySessionId,
          paymentUrl: existingAttempt?.redirectUrl || null,
          redirectUrl: existingAttempt?.redirectUrl || null,
          amount: Number(existingPayment.gatewayAmount || existingPayment.amount || checkoutSession.amount),
          currency: existingPayment.currency || checkoutSession.currency,
          mode: existingAttempt?.mode || domainGatewayMode(gatewayResolution),
          statusUrl: paymentStatusUrl(existingPayment.gatewayOrderId || checkoutSession.referenceId),
          extra: {
            checkoutSessionId: checkoutSession.id,
            checkoutOptions: existingPayment.gateway === "razorpay" ? asRecord(gatewayResponse.checkout) || null : null,
            checkout_options: existingPayment.gateway === "razorpay" ? asRecord(gatewayResponse.checkout) || null : null,
            brandName: existingPayment.gateway === "razorpay" ? gatewayResponse.brandName || null : null,
            brandImage: existingPayment.gateway === "razorpay" ? gatewayResponse.brandImage || null : null,
            merchantName: existingPayment.gateway === "razorpay" ? gatewayResponse.brandName || null : null,
            razorpayFlow: existingPayment.gateway === "razorpay" ? gatewayResponse.razorpayFlow || "order" : undefined,
            ...state,
          },
        })
        trace.start("response", { checkoutSessionId: checkoutSession.id, paymentId: existingPayment.id, reused: true })
        trace.pass("response", {
          checkoutSessionId: checkoutSession.id,
          paymentId: existingPayment.id,
          gatewayOrderId: payload.gatewayOrderId || null,
          status: 200,
        })
        return NextResponse.json(payload)
      }
      console.info("[Payments][Create] pending INR checkout records", {
        customerId: customer.id,
        productId: productId || offerData?.productId || null,
        checkoutSessionId: checkoutSession.id,
        amount: chargedAmount,
        currency: chargedCurrency,
        gateway: gatewayPriority[0] || null,
      })
      if (body.prepareCheckoutOnly) {
        trace.start("response", { checkoutSessionId: checkoutSession.id, reused: false })
        trace.pass("response", { checkoutSessionId: checkoutSession.id, status: 200, reason: "checkout_session_prepared" })
        return NextResponse.json({
          success: true,
          ok: true,
          checkoutSessionId: checkoutSession.id,
          referenceId: checkoutSession.referenceId,
          amount: chargedAmount,
          currency: chargedCurrency,
          status: checkoutSession.status,
          gateway: gatewayPriority[0] || null,
          invoiceId: null,
          paymentId: null,
          reason: "checkout_session_prepared",
        })
      }

      const startGateway = async (gateway: "razorpay" | "cashfree" | "phonepe") => {
        const gatewayConfig = gatewayCandidates.find((config) => config.gateway === gateway) || configForGateway(gatewayResolution!, gateway)
        const urls = urlsForGateway(gatewayResolution!, gatewayConfig, referenceId, request)
        currentCheckoutStage = "gateway_credentials"
        const publicRuntime = publicGatewayRuntime(gatewayConfig)
        trace.start("gateway_credentials", {
          gateway,
          gatewayConfigId: gatewayConfig?.id || gatewayConfig?.paymentGatewayId || null,
          credentialSource: "database",
          publicRuntime,
        })
        trace.pass("gateway_credentials", { gateway, hasRuntimeConfig: Boolean(gatewayConfig), missingFields: publicRuntime.missingFields })
        await recordGatewayAttempt({ gateway, status: "started", requestId: referenceId })
        currentCheckoutStage = "gateway_order_creation"
        trace.start("gateway_order_creation", { gateway, referenceId, amount: chargedAmount, currency: chargedCurrency })
        currentCheckoutStage = "payment_creation"
        trace.start("payment_creation", { gateway, checkoutSessionId: checkoutSession.id, gatewayOrderId: null })
        const checkoutPayment = await getOrCreateCheckoutPayment({
          requestId,
          gateway,
          checkoutSessionId: checkoutSession.id,
          gatewayConfig,
          customerDetails: {
            customerId: customer.id,
            customerEmail: normalizedSessionEmail,
            customerPhone: customerDetails.phone,
            customerName: customerDetails.name,
          },
          orderNote: productName,
          returnUrl: urls.returnUrl,
          webhookUrl: urls.webhookUrl,
          invoiceNumber: invoiceNumberForReference(referenceId),
          paymentData: {
            checkoutSessionId: checkoutSession.id,
            customerId: customer.id,
            gateway,
            amount: chargedAmount,
            currency: chargedCurrency,
            status: "created",
            purpose,
            walletAppliedAmount: 0,
            gatewayAmount: chargedAmount,
            idempotencyKey: `${referenceId}-${gateway}-init`,
          },
          paymentAttemptData: {
            userId: customer.id,
            domainId: gatewayResolution?.domainConfig?.id || null,
            gatewayConfigId: gatewayConfig?.id || null,
            gateway,
            sourceDomain: gatewayResolution?.sourceDomain || null,
            approvedDomain: gatewayResolution?.approvedPaymentDomain || null,
            approvedPaymentDomain: gatewayResolution?.approvedPaymentDomain || null,
            merchantOrderId: referenceId,
            amount: chargedAmount,
            currency: chargedCurrency,
            status: "created",
            mode: modeForGatewayConfig(gatewayConfig, gatewayResolution),
            returnUrl: urls.returnUrl,
          },
        })
        const paymentRecord = checkoutPayment.payment
        const paymentAttempt = checkoutPayment.attempt
        const session = asRecord(paymentRecord.gatewayResponse)
        trace.pass("gateway_order_creation", {
          gateway,
          gatewayOrderId: paymentRecord.gatewayOrderId || null,
          hasGatewaySessionId: Boolean(paymentRecord.gatewaySessionId),
          hasRedirectUrl: Boolean(paymentAttempt?.redirectUrl),
        })
        trace.pass("payment_creation", { paymentId: paymentRecord.id, gateway, gatewayOrderId: paymentRecord.gatewayOrderId || null })
        await logGatewayDecision({
          resolution: gatewayResolution,
          selectedConfig: gatewayConfig,
          customerId: customer.id,
          paymentAttemptId: paymentAttempt?.id || null,
          message: "payment_gateway_resolution_decision",
          extra: { purpose, checkoutSessionId: checkoutSession.id, merchantOrderId: referenceId },
        })
        currentCheckoutStage = "transaction_commit"
        trace.pass("transaction_commit", { checkoutSessionId: checkoutSession.id, paymentId: paymentRecord.id, status: "gateway_redirected" })
        await recordGatewayAttempt({ paymentId: paymentRecord.id, gateway, status: "success", requestId: paymentRecord.gatewayOrderId })
        const payload = paymentInitPayload({
          payment: paymentRecord,
          gateway,
          gatewayOrderId: paymentRecord.gatewayOrderId,
          paymentSessionId: paymentRecord.gatewaySessionId,
          paymentUrl: paymentAttempt?.redirectUrl || null,
          redirectUrl: paymentAttempt?.redirectUrl || null,
          amount: chargedAmount,
          currency: chargedCurrency,
          mode: domainGatewayMode(gatewayResolution),
          statusUrl: paymentStatusUrl(paymentRecord.gatewayOrderId || referenceId),
          extra: {
            publicKey: publicRuntime.publicKey || undefined,
            checkoutSessionId: checkoutSession.id,
            orderNumber,
            discountAmount,
            couponCode,
            walletAppliedAmount: 0,
            gatewayAmount: chargedAmount,
            verified: false,
            reason: checkoutPayment.reason || "gateway_initiated",
            message: checkoutPayment.message || "Opening secure Razorpay checkout...",
            reusedExistingPayment: Boolean(checkoutPayment.reused),
            status: checkoutPayment.status || "gateway_started",
            checkoutOptions: asRecord(session.checkout) || null,
            checkout_options: asRecord(session.checkout) || null,
            brandName: session.brandName || null,
            brandImage: session.brandImage || null,
            merchantName: session.brandName || null,
            razorpayFlow: session.razorpayFlow || "order",
            razorpayTraceId: session.razorpayTraceId || null,
            couponDiscountAmount: discountAmount,
            couponDiscountPercent: pricingSnapshot.discountPercent,
            taxAmount,
            payableToday: payableAmount,
          },
        })
        logPaymentInitResult({
          orderId: payload.orderId,
          invoiceId: payload.invoiceId,
          gateway: payload.gateway,
          gatewayOrderId: payload.gatewayOrderId,
          paymentSessionId: payload.paymentSessionId,
          redirectUrl: payload.redirectUrl,
        })
        return NextResponse.json(payload)
      }

      if (cashfreeRuntime.paymentMode === "mock") {
        await prisma.checkoutSession.update({ where: { id: checkoutSession.id }, data: { status: "payment_failed" } }).catch(() => undefined)
        return apiError("razorpay_required", "Razorpay Standard Checkout must be configured before customer payments can be started.", 503)
      }

      // Explicit customer selection ALWAYS controls the gateway (priority only
      // for automatic routing). Failsafe fallback only when the selected
      // gateway opts in (failsafeEnabled) and another gateway is eligible.
      const directAttemptPlan = selectGatewayAttemptPlan({
        candidates: (gatewayCandidates as any[])?.map((config: any) => ({
          gateway: String(config?.gateway || config?.code || "").toLowerCase(),
          priority: Number(config?.priority ?? 100),
          failsafeEnabled: Boolean(config?.failsafeEnabled),
        })) || [],
        preferredGateway,
        explicitSelection: explicitGatewaySelected,
      })
      const gatewayAttemptOrder = directAttemptPlan.attemptOrder
      if (!gatewayAttemptOrder.length) {
        await prisma.checkoutSession.update({ where: { id: checkoutSession.id }, data: { status: "payment_failed" } }).catch(() => undefined)
        const message = explicitGatewaySelected && preferredGateway
          ? gatewayUnavailableMessage(preferredGateway)
          : missingGatewayConfigMessage(gatewayResolution)
        return apiError("GATEWAY_UNAVAILABLE", message, 503)
      }
      let lastGatewayError: any = null
      for (const [attemptIndex, gateway] of gatewayAttemptOrder.entries()) {
        const fallbackUsed = attemptIndex > 0
        try {
          const result = await startGateway(gateway as "razorpay" | "cashfree" | "phonepe")
          if (fallbackUsed) {
            const payload = await responsePayload(result)
            createPanelLog({
              category: "Payment",
              level: "warn",
              message: "payment_gateway_fallback",
              orderId: payload?.orderId || null,
              paymentId: payload?.paymentId || payload?.paymentSessionId || null,
              metadata: {
                requestedGateway: directAttemptPlan.requestedGateway,
                actualGateway: gateway,
                fallbackUsed,
                checkoutSessionId: checkoutSession.id,
                requestId: referenceId,
              },
            }).catch(() => null)
          }
          return result
        } catch (gatewayError: any) {
          lastGatewayError = gatewayError
          await recordGatewayAttempt({
            gateway,
            status: "failed",
            requestId: referenceId,
            ...safeGatewayError(gatewayError),
            metadata: {
              requestedGateway: directAttemptPlan.requestedGateway,
              actualGateway: gateway,
              fallbackUsed,
              policy: directAttemptPlan.policy,
              checkoutSessionId: checkoutSession.id,
            },
          })
        }
      }
      {
        await prisma.checkoutSession.update({ where: { id: checkoutSession.id }, data: { status: "payment_failed" } }).catch(() => undefined)
        const explicitFailureMessage = directAttemptPlan.policy === "explicit"
          ? `${gatewayDisplayName(directAttemptPlan.requestedGateway || "")} payment could not be initialized. Please try again or select another payment method.`
          : null
        return apiError("PAYMENT_START_FAILED", explicitFailureMessage || lastGatewayError?.message || "Payment could not be started. Please try again.", 502)
      }
    }
    const recentCheckoutSince = new Date(Date.now() - 15 * 60 * 1000)
    const reusableAmount = Number(payableAmount || 0)
    const reusablePendingOrder = purpose === "order_payment" && !pendingCustomConfig
      ? await prisma.order.findFirst({
          where: {
            customerId: customer.id,
            productId: productId ? String(productId) : null,
            offerId: offerData?.id || null,
            termMonths: parsedTerm,
            status: "pending",
            totalAmount: {
              gte: Number(Math.max(0, reusableAmount - 0.01).toFixed(2)),
              lte: Number((reusableAmount + 0.01).toFixed(2)),
            },
            hostname: String(requestedHostname || "").trim(),
            OR: isDedicatedCheckout
              ? [
                  {
                    operatingSystemId: null,
                    requestedOsFamily: dedicatedOsOption?.family || null,
                    requestedOsVersion: dedicatedOsOption?.version || null,
                  },
                ]
              : [
                  { operatingSystemId: selectedOperatingSystem?.id || null },
                  {
                    requestedOsFamily,
                    requestedOsVersion,
                  },
                ],
            createdAt: { gte: recentCheckoutSince },
          },
          include: {
            invoices: true,
            payments: { orderBy: { createdAt: "desc" }, take: 1 },
          },
          orderBy: { createdAt: "desc" },
        }).catch(() => null)
      : null
    console.log("[Payments][Create] order creation payload", {
      customerId: customer.id,
      productId: productId || null,
      customConfigId: customConfigId || null,
      term: parsedTerm,
      unitPrice,
      subtotal,
      taxAmount,
      originalAmount,
      discountAmount,
      payableAmount,
      purpose,
    })

    currentCheckoutStage = "order_creation"
    trace.start("order_creation", {
      referenceId: orderNumber,
      orderNumber,
      customerId: customer.id,
      productId: productId || null,
      offerId: offerData?.id || null,
      customConfigId: customConfigId || null,
      reusedPendingOrderId: reusablePendingOrder?.id || null,
      purpose,
    })
    const order =
      purpose === "topup"
        ? null
        : (purpose === "upgrade_order" || purpose === "billable_order") && existingOrderId
          ? await prisma.order.findFirst({
              where: { id: String(existingOrderId), customerId: customer.id },
            })
          : reusablePendingOrder || await prisma.order.create({
              data: {
                orderNumber,
                customerId: customer.id,
                productId: productId || undefined,
                offerId: offerData?.id || undefined,
                customConfigId: customConfigId || undefined,
                orderType: isDedicatedCheckout ? "dedicated" : offerData ? "offer" : undefined,
                offerSnapshot: offerSnapshot || undefined,
                nodeClassId: offerData?.nodeClassId || undefined,
                nodeClassSnapshot: offerData?.nodeClassRef ? {
                  id: offerData.nodeClassRef.id,
                  name: offerData.nodeClassRef.name,
                  slug: offerData.nodeClassRef.slug,
                  publicLabel: offerData.nodeClassRef.publicLabel,
                } : undefined,
                storagePoolId: offerData?.storagePoolId || selectedStoragePool?.id || undefined,
                storagePoolSnapshot: offerData?.proxmoxNodeStoragePool ? {
                  id: offerData.proxmoxNodeStoragePool.id,
                  storageId: offerData.proxmoxNodeStoragePool.storageId,
                  displayName: offerData.proxmoxNodeStoragePool.displayName || offerData.proxmoxNodeStoragePool.storageId,
                  premium: offerData.proxmoxNodeStoragePool.premium,
                  allowNewPurchase: offerData.proxmoxNodeStoragePool.allowNewPurchase,
                  pricePerGbMonthly: Number(offerData.proxmoxNodeStoragePool.pricePerGbMonthly || 0),
                } : selectedStoragePool ? snapshotStoragePool(selectedStoragePool, { includedDiskGb: selectedStorageDiskGb, diskGb: selectedStorageDiskGb }) as any : undefined,
                termMonths: parsedTerm,
                unitPrice,
                quantity: 1,
                subtotal,
                taxAmount,
                discountAmount,
                totalAmount: payableAmount,
                originalAmount,
                finalAmount: payableAmount,
                payableAmount,
                couponCode,
                couponId,
                operatingSystemId: isDedicatedCheckout ? null : selectedOperatingSystem?.id || null,
                requestedOsFamily: isDedicatedCheckout ? dedicatedOsOption?.family || null : requestedOsFamily,
                requestedOsVersion: isDedicatedCheckout ? dedicatedOsOption?.version || null : requestedOsVersion,
                osName: isDedicatedCheckout ? dedicatedOsOption?.name || null : selectedOperatingSystem?.name || null,
                templateVmid: null,
                proxmoxNodeId: null,
                gatewayMode: cashfreeRuntime.paymentMode,
                currency: "INR",
                status: paymentMethod === "gateway" ? "pending_payment" : "pending",
                hostname: purpose === "order_payment" ? String(requestedHostname || "").trim() : null,
                adminUsername: purpose === "order_payment" && !isDedicatedCheckout ? String(requestedAdminUsername || resolvedOsTemplateDefaultUsername(selectedOperatingSystem) || "root") : null,
                passwordEncrypted: orderPasswordEncrypted,
                accessMethod: purpose === "order_payment" ? (isDedicatedCheckout ? "MANUAL_DELIVERY" : orderAccessMethod) : null,
                sshKeyId: orderSshKeyId,
                sshPublicKey: orderSshPublicKey,
                  metadata: {
                  productName: offerData?.name || productDisplayName(productData, customConfigData || pendingCustomConfig),
                  offer: offerSnapshot,
                  customerDetails: { ...customerDetails, email: normalizedSessionEmail },
                  billingAddress: billingAddressSnapshot,
                  pricingSnapshot: {
                    subtotal: pricingSnapshot.subtotal,
                    discount: pricingSnapshot.discount,
                    discountPercent: pricingSnapshot.discountPercent,
                    taxableAmount: pricingSnapshot.taxableAmount,
	                    gst: pricingSnapshot.gst,
	                    total: pricingSnapshot.total,
	                  },
	                  premiumIps: canonicalPricing?.premiumIps || (premiumIpRequest.enabled ? premiumIpRequest.pricing : null),
	                  configuration: config || null,
                  operatingSystem: selectedOperatingSystem
                    ? {
                        id: selectedOperatingSystem.id,
                        name: selectedOperatingSystem.name,
                        proxmoxVmid: selectedOperatingSystem.proxmoxVmid,
                        proxmoxNodeId: selectedOperatingSystem.proxmoxNodeId,
                        family: requestedOsFamily,
                        version: requestedOsVersion,
                      }
                    : null,
                  dedicated: isDedicatedCheckout
                    ? {
                        osOptionId: dedicatedOsOption?.id || null,
                        osFamily: dedicatedOsOption?.familyLabel || dedicatedOsOption?.family || null,
                        osName: dedicatedOsOption?.name || null,
                        deliverySlaHours: dedicatedSettings?.deliverySlaHours || 72,
                        estimatedDeliveryLabel: `Delivery within ${dedicatedSettings?.deliverySlaHours || 72} hours after payment confirmation`,
                        installationNotes: String(requestedInstallationNotes || "").trim() || null,
                        sshKeyProvided: Boolean(String(requestedDedicatedSshPublicKey || "").trim()),
                        ipmiRequired: Boolean(requestedIpmiRequired),
                        setupFee: dedicatedSetupFee,
                        bandwidthLabel: dedicatedSettings?.bandwidthLabel || null,
                        location: dedicatedSettings?.location || null,
                      }
                    : null,
                  upgrade:
                    purpose === "upgrade_order"
                      ? {
                          vpsInstanceId: vpsInstanceId || null,
                          toCpuCores: upgradeCpuCores ? Number(upgradeCpuCores) : null,
                          toRamGb: upgradeRamGb ? Number(upgradeRamGb) : null,
                          toDiskGb: upgradeDiskGb ? Number(upgradeDiskGb) : null,
                        }
                      : null,
                  pricingMeta: fixedPricingMeta
                    ? {
                        calculatedMonthlyPrice: fixedPricingMeta.calculatedMonthlyPrice,
                        productMonthlyPrice: fixedPricingMeta.productMonthlyPrice,
                        fixedDiscountAmount: fixedPricingMeta.fixedDiscountAmount,
                        fixedDiscountPercent: fixedPricingMeta.fixedDiscountPercent,
                      }
                    : customPricingMeta
                      ? {
                          baseMonthly: customPricingMeta.baseMonthly,
                          discountedMonthly: customPricingMeta.discountedMonthly,
                          discountPercent: customPricingMeta.discountPercent,
                          subtotal: customPricingMeta.subtotal,
                          taxRate: customPricingMeta.taxRate,
                          taxAmount: customPricingMeta.taxAmount,
                          grandTotal: customPricingMeta.grandTotal,
                          breakdown: customPricingMeta.breakdown,
                        }
                      : null,
                } as any,
              },
            })
    trace.pass("order_creation", {
      orderId: order?.id || null,
      orderNumber: order?.orderNumber || orderNumber,
      reused: Boolean(reusablePendingOrder),
    })

    if (reusablePendingOrder) {
      console.log("[Payments][Create] reusing recent pending order", {
        orderId: reusablePendingOrder.id,
        orderNumber: reusablePendingOrder.orderNumber,
        customerId: customer.id,
      })
    }
    console.info("[Payments][Create] INR order insert result", {
      orderId: order?.id || null,
      orderNumber: order?.orderNumber || orderNumber,
      customerId: customer.id,
      productId: productId || offerData?.productId || null,
      offerId: offerData?.id || null,
      amount: payableAmount,
      currency: "INR",
      preferredGateway: preferredGateway || null,
      reused: Boolean(reusablePendingOrder),
    })

    if (!reusablePendingOrder && isDedicatedCheckout && order && purpose === "order_payment" && productData && dedicatedSettings) {
      await createPendingDedicatedServiceForOrder({
        orderId: order.id,
        customerId: customer.id,
        productId: productData.id,
        osOptionId: dedicatedOsOption?.id || null,
        hostname: String(requestedHostname || "").trim(),
        installationNotes: String(requestedInstallationNotes || "").trim() || null,
        sshPublicKey: String(requestedDedicatedSshPublicKey || "").trim() || null,
        ipmiRequired: Boolean(requestedIpmiRequired),
        deliverySlaHours: dedicatedSettings.deliverySlaHours,
      })
    }

    if (!reusablePendingOrder && offerData && order && purpose === "order_payment") {
      await prisma.offer.update({ where: { id: offerData.id }, data: { purchasesCount: { increment: 1 } } }).catch(() => undefined)
      await logPaymentPanelEvent({
        message: "offer_order_created",
        level: "info",
        customerId: customer.id,
        orderId: order.id,
        metadata: { offerId: offerData.id, offerSlug: offerData.slug, amount: payableAmount },
      })
    }

    if ((purpose === "upgrade_order" || purpose === "billable_order") && !order) {
      return apiError("upgrade_order_missing", purpose === "upgrade_order" ? "Upgrade order not found for this customer." : "Billable order not found for this customer.", 404)
    }

    const referenceId = order?.orderNumber || `TOPUP-${orderNumber}`
    let invoice: Awaited<ReturnType<typeof createInvoiceForOrder>> | null = null
    if (order && (purpose === "order_payment" || purpose === "upgrade_order" || purpose === "billable_order")) {
      try {
        invoice = reusablePendingOrder?.invoices || await createInvoiceForOrder(order.id, { allowPending: true })
        if (!reusablePendingOrder?.invoices) {
          if (offerData) {
            await logPaymentPanelEvent({
              message: "offer_invoice_created",
              level: "info",
              customerId: customer.id,
              orderId: order.id,
              metadata: { offerId: offerData.id, invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber },
            })
          }
          await Promise.all([
            sendOrderInvoiceNotification({ templateKey: "order_created", orderId: order.id, invoiceId: invoice.id, paymentUrl: paymentStatusUrl(referenceId), metadata: { source: "payment_create" } }),
            sendOrderInvoiceNotification({ templateKey: "order_pending_payment", orderId: order.id, invoiceId: invoice.id, paymentUrl: paymentStatusUrl(referenceId), metadata: { source: "payment_create" } }),
            sendOrderInvoiceNotification({ templateKey: "invoice_created", orderId: order.id, invoiceId: invoice.id, paymentUrl: paymentStatusUrl(referenceId), metadata: { source: "payment_create" } }),
          ]).catch((emailError) => {
            console.error("[Payments][Create] pending order email failed", { orderId: order.id, message: emailError?.message })
          })
          if (isDedicatedCheckout) {
            const service = await prisma.dedicatedService.findUnique({ where: { orderId: order.id }, select: { id: true } }).catch(() => null)
            if (service) await sendDedicatedEmail("dedicated_order_created", service.id, { source: "payment_create" }).catch(() => null)
          }
        }
      } catch (error: any) {
        console.error("[Payments][Create] pending invoice creation failed", { orderId: order.id, message: error?.message })
      }
    }
    let reusablePayment = order
      ? await prisma.payment.findFirst({
          where: {
            orderId: order.id,
            status: { in: ["created", "pending"] },
            gateway: { in: ["razorpay", "cashfree", "phonepe"] },
            createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
            OR: [
              { gatewaySessionId: { not: null } },
              { gatewayOrderId: { not: null } },
            ],
          },
          orderBy: { createdAt: "desc" },
        }).catch(() => null)
      : null
    if (reusablePayment?.gateway === "razorpay") {
      const response = asRecord(reusablePayment.gatewayResponse)
      const checkout = asRecord(response.checkout)
      if (response.razorpayFlow !== "order" || !String(checkout.order_id || reusablePayment.gatewayOrderId || "").trim()) {
        reusablePayment = null
      }
    }
    if (reusablePayment) {
      const reusableGatewayResponse = asRecord(reusablePayment.gatewayResponse)
      const reusableAttempt = await prisma.paymentAttempt.findFirst({
        where: { paymentId: reusablePayment.id },
        orderBy: { createdAt: "desc" },
      }).catch(() => null)
      const payload = paymentInitPayload({
        order,
        invoice,
        payment: reusablePayment,
        gateway: reusablePayment.gateway,
        gatewayOrderId: reusablePayment.gatewayOrderId,
        paymentSessionId: reusablePayment.gatewaySessionId,
        paymentUrl: reusableAttempt?.redirectUrl || null,
        redirectUrl: reusableAttempt?.redirectUrl || null,
        amount: Number(reusablePayment.gatewayAmount || reusablePayment.amount || 0),
        currency: reusablePayment.currency,
        mode: reusableAttempt?.mode === "direct" ? domainGatewayMode(gatewayResolution) : reusableAttempt?.mode || domainGatewayMode(gatewayResolution),
        statusUrl: paymentStatusUrl(reusablePayment.gatewayOrderId || order?.orderNumber),
        extra: {
          reusedExistingPayment: true,
          gatewayAmount: Number(reusablePayment.gatewayAmount || reusablePayment.amount || 0),
          walletAppliedAmount: Number(reusablePayment.walletAppliedAmount || 0),
          reason: "reused_pending_payment",
          checkoutOptions: reusablePayment.gateway === "razorpay" ? asRecord(reusableGatewayResponse.checkout) || null : null,
          checkout_options: reusablePayment.gateway === "razorpay" ? asRecord(reusableGatewayResponse.checkout) || null : null,
          brandName: reusablePayment.gateway === "razorpay" ? reusableGatewayResponse.brandName || null : null,
          brandImage: reusablePayment.gateway === "razorpay" ? reusableGatewayResponse.brandImage || null : null,
          merchantName: reusablePayment.gateway === "razorpay" ? reusableGatewayResponse.brandName || null : null,
          razorpayFlow: reusablePayment.gateway === "razorpay" ? reusableGatewayResponse.razorpayFlow || "order" : undefined,
        },
      })
      logPaymentInitResult({
        orderId: payload.orderId,
        invoiceId: payload.invoiceId,
        gateway: payload.gateway,
        gatewayOrderId: payload.gatewayOrderId,
        paymentSessionId: payload.paymentSessionId,
        redirectUrl: payload.redirectUrl,
      })
      return NextResponse.json(payload)
    }
    let walletApplied = 0
    let gatewayAmount = payableAmount
    const walletReference = order?.orderNumber || referenceId
    const effectiveWalletIdempotencyKey = paymentMethod === "wallet" && purpose !== "topup"
      ? walletOrderIdempotencyKey || (order?.id ? `wallet:${customer.id}:order:${order.id}` : null)
      : null
    if (purpose !== "topup" && paymentMethod === "wallet") {
      if (!paymentSettings.allowWalletPayments) {
        return apiError("wallet_disabled", "Wallet payments are not enabled.", 400)
      }
      if (effectiveWalletIdempotencyKey) {
        const existingWalletPayment = await prisma.payment.findUnique({
          where: { idempotencyKey: effectiveWalletIdempotencyKey },
          include: { order: true, invoice: true },
        }).catch(() => null)
        if (existingWalletPayment && ["completed", "paid", "success"].includes(String(existingWalletPayment.status || "").toLowerCase())) {
          const redirect = await orderRedirectPayload(existingWalletPayment.orderId)
          return NextResponse.json({
            ...redirect,
            success: true,
            ok: true,
            status: "paid",
            paymentMethod: "wallet",
            gateway: "wallet",
            orderId: existingWalletPayment.orderId,
            orderNumber: existingWalletPayment.order?.orderNumber || null,
            invoiceId: existingWalletPayment.invoiceId,
            paymentId: existingWalletPayment.id,
            amount: Number(existingWalletPayment.amount || 0),
            currency: existingWalletPayment.currency,
            walletAppliedAmount: Number(existingWalletPayment.walletAppliedAmount || existingWalletPayment.amount || 0),
            gatewayAmount: 0,
            verified: true,
            reason: "wallet_payment_reused",
          })
        }
      }
      const freshCustomer = await prisma.customer.findUnique({
        where: { id: customer.id },
        select: { walletBalance: true },
      })
      if (Number(freshCustomer?.walletBalance || 0) < payableAmount) {
        return apiError("wallet_insufficient", "Insufficient wallet balance.", 400)
      }
      walletApplied = payableAmount
      gatewayAmount = 0
    } else if (purpose !== "topup") {
      walletApplied = 0
      gatewayAmount = payableAmount
    }
    if (purpose === "order_payment" && gatewayAmount > 0 && Math.abs(Number(gatewayAmount) - Number(pricingSnapshot.total)) > 0.009) {
      await logPaymentPanelEvent({
        message: "payment_amount_mismatch",
        level: "error",
        customerId: customer.id,
        orderId: order?.id || null,
        metadata: {
          gatewayAmount,
          pricingTotal: pricingSnapshot.total,
          subtotal: pricingSnapshot.subtotal,
          discount: pricingSnapshot.discount,
          taxableAmount: pricingSnapshot.taxableAmount,
          gst: pricingSnapshot.gst,
        },
      })
      return apiError("payment_amount_mismatch", "Payment amount mismatch. Please refresh checkout and try again.", 409)
    }

    if (gatewayAmount <= 0) {
      if (order && purpose === "billable_order" && ["paid", "verification_pending"].includes(String(order.status || "").toLowerCase())) {
        const redirect = await orderRedirectPayload(order.id)
        return NextResponse.json({
          ...redirect,
          success: true,
          ok: true,
          status: "paid",
          paymentMethod: "wallet",
          gateway: "wallet",
          orderId: order.id,
          orderNumber: order.orderNumber || null,
          invoiceId: invoice?.id || null,
          amount: payableAmount,
          currency: "INR",
          walletAppliedAmount: 0,
          gatewayAmount: 0,
          verified: true,
          reason: "wallet_billable_already_paid",
        })
      }
      const walletSettlement = await prisma.$transaction(async (tx) => {
        const lockedCustomer = await tx.customer.findUnique({
          where: { id: customer.id },
          select: { walletBalance: true },
        })
        const balanceBefore = Number(lockedCustomer?.walletBalance || 0)
        if (balanceBefore < payableAmount) {
          throw Object.assign(new Error("Insufficient wallet balance."), { code: "wallet_insufficient", status: 400 })
        }
        const balanceAfter = Number((balanceBefore - payableAmount).toFixed(2))
        const debited = await tx.customer.updateMany({
          where: { id: customer.id, walletBalance: { gte: payableAmount } },
          data: { walletBalance: { decrement: payableAmount } },
        })
        if (debited.count !== 1) {
          throw Object.assign(new Error("Insufficient wallet balance."), { code: "wallet_insufficient", status: 400 })
        }
        const payment = await tx.payment.create({
          data: {
            orderId: order?.id,
            invoiceId: invoice?.id,
            customerId: customer.id,
            gateway: "wallet",
            amount: payableAmount,
            currency: "INR",
            status: "completed",
            paymentMethod: "wallet",
            purpose,
            idempotencyKey: effectiveWalletIdempotencyKey,
            topupReference: purpose === "topup" ? referenceId : null,
            walletAppliedAmount: walletApplied,
            gatewayAmount: 0,
            completedAt: new Date(),
          },
        })
        const walletTransaction = await tx.walletTransaction.create({
          data: {
            customerId: customer.id,
            paymentId: payment.id,
            orderId: order?.id || null,
            type: "payment",
            amount: payableAmount,
            currency: "INR",
            balanceBefore,
            balanceAfter,
            status: "completed",
            reason: "Paid invoice from wallet",
            note: invoice?.invoiceNumber ? `Wallet payment for ${invoice.invoiceNumber}` : "Wallet payment",
            referenceId: walletReference,
            gateway: null,
            gatewayFee: null,
            createdByType: "system",
          },
        })
        const updatedPayment = await tx.payment.update({
          where: { id: payment.id },
          data: {
            transactionId: walletTransaction.id,
            gatewayTransactionId: walletTransaction.id,
            paymentMethodDetails: { walletTransactionId: walletTransaction.id, balanceBefore, balanceAfter },
          },
        })
        if (order) await tx.order.update({ where: { id: order.id }, data: { status: "paid" } })
        if (invoice) {
          await tx.invoice.update({
            where: { id: invoice.id },
            data: {
              status: "paid",
              paidAt: new Date(),
              paymentTransactionId: walletTransaction.id,
              metadata: {
                ...((invoice.metadata && typeof invoice.metadata === "object" && !Array.isArray(invoice.metadata)) ? invoice.metadata as Record<string, unknown> : {}),
                paymentId: payment.id,
                walletTransactionId: walletTransaction.id,
                gateway: "wallet",
              },
            },
          })
        }
        return { payment: updatedPayment, walletTransaction }
      })
      const walletPayment = walletSettlement.payment
      let paidInvoice = invoice

      if (order) {
        paidInvoice = await createInvoiceForOrder(order.id, { paymentId: walletPayment.id }).catch((error) => {
          console.error("[Payments][Create] wallet invoice creation failed", { orderId: order.id, message: error?.message })
          return invoice
        }) || invoice
        await Promise.all([
          sendOrderInvoiceNotification({ templateKey: "order_paid", orderId: order.id, invoiceId: paidInvoice?.id || invoice?.id || null, metadata: { source: "wallet_payment" } }),
          sendOrderInvoiceNotification({ templateKey: "invoice_paid", orderId: order.id, invoiceId: paidInvoice?.id || invoice?.id || null, metadata: { source: "wallet_payment" } }),
        ]).catch((emailError) => {
          console.error("[Payments][Create] wallet payment email failed", { orderId: order.id, message: emailError?.message })
        })
        const invoiceForFinalization = paidInvoice?.id || invoice?.id || null
        const finalization = invoiceForFinalization
          ? handlePaidInvoice(invoiceForFinalization, {
              paymentId: walletPayment.id,
              actor: "wallet",
              autoProvision: shouldAutoProvision({ paymentSettings, paymentMode: cashfreeRuntime.paymentMode, walletCovered: true }),
              purpose,
              transactionId: walletPayment.gatewayTransactionId || walletPayment.transactionId,
            })
          : finalizePaidOrder({
              orderId: order.id,
              paymentId: walletPayment.id,
              actor: "wallet",
              autoProvision: shouldAutoProvision({ paymentSettings, paymentMode: cashfreeRuntime.paymentMode, walletCovered: true }),
              purpose,
              transactionId: walletPayment.gatewayTransactionId || walletPayment.transactionId,
            })
        await finalization.catch((error) => {
          console.error("[Payments][Create] wallet paid finalization failed", { orderId: order.id, message: error?.message })
        })
        await recordCouponRedemption({
          couponId,
          orderId: order.id,
          customerId: String(client.sub),
          paymentId: walletPayment.id,
          discountAmount,
          gatewayOrderId: referenceId,
          metadata: { source: "wallet_payment" },
        })
      }

      const walletRedirect = await orderRedirectPayload(order?.id)
	      return NextResponse.json({
        ...walletRedirect,
		          success: true,
		          ok: true,
          status: "paid",
          paymentMethod: "wallet",
		          orderNumber: order?.orderNumber || referenceId,
          orderId: order?.id || null,
		          invoiceId: paidInvoice?.id || invoice?.id || null,
	        paymentId: walletPayment.id,
	        amount: payableAmount,
        currency: "INR",
        discountAmount,
        couponCode,
        walletAppliedAmount: walletApplied,
        gatewayAmount: 0,
        paymentMode: "wallet",
        mode: cashfreeRuntime.mode,
	        gateway: "wallet",
	        usedFallback: false,
	        statusUrl: paymentStatusUrl(referenceId),
        verified: true,
        reason: "wallet_covered",
        mock: cashfreeRuntime.paymentMode === "mock",
        pricingMeta: fixedPricingMeta ? {
          calculatedMonthlyPrice: fixedPricingMeta.calculatedMonthlyPrice,
          productMonthlyPrice: fixedPricingMeta.productMonthlyPrice,
          fixedDiscountAmount: fixedPricingMeta.fixedDiscountAmount,
          fixedDiscountPercent: fixedPricingMeta.fixedDiscountPercent,
        } : null,
        couponDiscountAmount: discountAmount,
        couponDiscountPercent: pricingSnapshot.discountPercent,
        taxAmount,
        payableToday: payableAmount,
      })
    }

    // Enforce domain-scoped external gateway toggles and country rules.
	    const allowedGateways = allowedGatewayCountries(detectedCountry)
	    const gatewayCandidates = (await runtimeGatewayCandidates(request, preferredGateway))
        .filter((config) => allowedGateways.has(String(config.gateway || "")))
	    const gatewayPriority = gatewayCandidates.map((config) => config.gateway) as Array<"razorpay" | "cashfree" | "phonepe">
	    if (!gatewayCandidates.length) {
      if (order) {
        await prisma.order.update({ where: { id: order.id }, data: { status: "payment_failed" } })
      }
      await logGatewayDecision({
        resolution: gatewayResolution,
        message: "payment_config_missing",
        level: "warn",
        customerId: customer.id,
        orderId: order?.id || null,
	        extra: {
	          purpose,
	          message: missingGatewayConfigMessage(gatewayResolution),
	        },
	      })
		      return apiError("NO_GATEWAY_AVAILABLE", missingGatewayConfigMessage(gatewayResolution), 503)
		    }
		    const legacyShouldProcessGateway = (code: "phonepe" | "razorpay" | "cashfree") =>
		      explicitGatewaySelected ? preferredGateway === code : gatewayPriority.includes(code)
		    if (explicitGatewaySelected && preferredGateway && !gatewayPriority.includes(preferredGateway as any)) {
		      if (order) {
		        await prisma.order.update({ where: { id: order.id }, data: { status: "payment_failed" } })
		      }
		      await logGatewayDecision({
		        resolution: gatewayResolution,
		        level: "warn",
		        customerId: customer.id,
		        orderId: order?.id || null,
		        message: "explicit_gateway_unavailable",
		        extra: { purpose, selectedGateway: preferredGateway, availableGateways: gatewayPriority },
		      })
		      return apiError("GATEWAY_UNAVAILABLE", gatewayUnavailableMessage(preferredGateway), 503)
		    }
		    if (offerData) {
		      await logPaymentPanelEvent({
		        message: "payment_gateway_selected",
		        level: "info",
		        customerId: customer.id,
			        metadata: { offerId: offerData.id, primaryGateway: gatewayPriority[0], gatewayPriority, amount: gatewayAmount, sourceDomain: gatewayResolution?.sourceDomain || null },
		      })
			    }
		    if (gatewayPriority[0] === "phonepe") {
	      try {
	        await recordGatewayAttempt({ orderId: order?.id, gateway: "phonepe", status: "started", requestId: referenceId })
	        const phonepeConfig = gatewayCandidates.find((config) => config.gateway === "phonepe") || configForGateway(gatewayResolution!, "phonepe")
	        const phonepeUrls = urlsForGateway(gatewayResolution!, phonepeConfig, referenceId, request)
	        const phonepeOrder = await createDomainGatewayPaymentSession({
	          gateway: "phonepe",
	          orderId: referenceId,
	          amount: gatewayAmount,
          customerDetails: {
            customerId: customer.id,
            customerEmail: normalizedSessionEmail,
            customerPhone: customerDetails.phone,
            customerName: customerDetails.name,
	          },
	          orderNote: purpose === "topup" ? "Wallet top-up" : productDisplayName(productData, customConfigData),
	          returnUrl: phonepeUrls.returnUrl,
	          webhookUrl: phonepeUrls.webhookUrl,
	          gatewayConfig: phonepeConfig,
	        })
	        const paymentRecord = await prisma.payment.create({
	          data: {
	            orderId: order?.id,
	            invoiceId: invoice?.id,
	            customerId: customer.id,
	            gateway: "phonepe",
	            gatewayOrderId: phonepeOrder.gatewayOrderId,
	            gatewayPaymentId: phonepeOrder.gatewayPaymentId,
	            transactionId: phonepeOrder.gatewayTransactionId,
	            gatewayTransactionId: phonepeOrder.gatewayTransactionId,
	            gatewaySessionId: phonepeOrder.gatewaySessionId,
            amount: gatewayAmount,
            currency: "INR",
            status: "pending",
            purpose,
            topupReference: purpose === "topup" ? referenceId : null,
            walletAppliedAmount: walletApplied,
            gatewayAmount,
            idempotencyKey: `${referenceId}-phonepe-init`,
	            gatewayResponse: phonepeOrder.raw as any,
	          },
	        })
	        const paymentAttempt = await prisma.paymentAttempt.create({
	          data: {
	            orderId: order?.id,
	            invoiceId: invoice?.id,
	            paymentId: paymentRecord.id,
	            userId: customer.id,
	            domainId: gatewayResolution?.domainConfig?.id || null,
	            gatewayConfigId: phonepeConfig?.id || null,
	            gateway: "phonepe",
	            sourceDomain: gatewayResolution?.sourceDomain || null,
	            approvedDomain: gatewayResolution?.approvedPaymentDomain || null,
	            approvedPaymentDomain: gatewayResolution?.approvedPaymentDomain || null,
	            merchantOrderId: referenceId,
	            gatewayOrderId: phonepeOrder.gatewayOrderId,
	            gatewayPaymentId: phonepeOrder.gatewayPaymentId,
	            gatewayTransactionId: phonepeOrder.gatewayTransactionId,
	            amount: gatewayAmount,
	            currency: "INR",
	            status: "started",
	            mode: modeForGatewayConfig(phonepeConfig, gatewayResolution),
	            redirectUrl: phonepeOrder.redirectUrl,
	            returnUrl: phonepeUrls.returnUrl,
	            rawGatewayResponse: phonepeOrder.raw as any,
	          },
	        }).catch(() => null)
	        await logGatewayDecision({
	          resolution: gatewayResolution,
	          selectedConfig: phonepeConfig,
	          customerId: customer.id,
	          orderId: order?.id || null,
	          paymentAttemptId: paymentAttempt?.id || null,
	          message: "payment_gateway_resolution_decision",
	          extra: { purpose, merchantOrderId: referenceId },
	        })
	        await recordGatewayAttempt({ orderId: order?.id, paymentId: paymentRecord.id, gateway: "phonepe", status: "success", requestId: phonepeOrder.gatewayOrderId })
	        if (offerData) {
	          await logPaymentPanelEvent({
	            message: "payment_redirect_returned",
	            level: "info",
	            customerId: customer.id,
	            metadata: { offerId: offerData.id, gateway: "phonepe", paymentId: paymentRecord.id },
	          })
	        }
	        return NextResponse.json({
	          success: true,
	          ok: true,
	          orderNumber: order?.orderNumber || referenceId,
	          invoiceId: invoice?.id || null,
	          gatewayOrderId: phonepeOrder.gatewayOrderId,
	          paymentUrl: phonepeOrder.redirectUrl,
	          redirectUrl: phonepeOrder.redirectUrl,
	          statusUrl: paymentStatusUrl(referenceId),
          amount: gatewayAmount,
          currency: "INR",
          discountAmount,
          couponCode,
          couponDiscountAmount: discountAmount,
          couponDiscountPercent: pricingSnapshot.discountPercent,
          taxAmount,
          payableToday: payableAmount,
          walletAppliedAmount: walletApplied,
          gatewayAmount,
          gateway: "phonepe",
          usedFallback: false,
          verified: false,
          reason: "gateway_initiated",
          paymentId: paymentRecord.id,
        })
      } catch (phonepeError: any) {
        await recordGatewayAttempt({
          orderId: order?.id,
          gateway: "phonepe",
	          status: !explicitGatewaySelected && gatewayPriority.includes("cashfree") ? "fallback" : "failed",
          requestId: referenceId,
          ...safeGatewayError(phonepeError),
        })
	        if (explicitGatewaySelected || !gatewayPriority.includes("cashfree")) {
          if (order) await prisma.order.update({ where: { id: order.id }, data: { status: "payment_failed" } })
	          await logPaymentPanelEvent({
	            message: offerData ? "offer_payment_init_failed" : "payment_create_failed",
            level: "error",
            customerId: customer.id,
            metadata: { gateway: "phonepe", code: phonepeError?.code || null, message: phonepeError?.message || null, explicitGatewaySelected },
          })
          return apiError("PAYMENT_START_FAILED", phonepeError?.message || "Payment could not be started. Please try again.", 502)
        }
        console.warn("[Payments][Create] PhonePe preferred gateway failed; falling back to Cashfree", {
          referenceId,
          message: phonepeError?.message,
        })
      }
    }

    if (legacyShouldProcessGateway("razorpay")) {
      try {
        await recordGatewayAttempt({ orderId: order?.id, gateway: "razorpay", status: "started", requestId: referenceId })
        const razorpayConfig = gatewayCandidates.find((config) => config.gateway === "razorpay") || configForGateway(gatewayResolution!, "razorpay")
        const razorpayUrls = urlsForGateway(gatewayResolution!, razorpayConfig, referenceId, request)
        const checkoutSessionResult = await getOrCreateCheckoutSession({
          requestId,
          data: {
            referenceId,
            idempotencyKey: normalizedIdempotencyKey ? `${normalizedIdempotencyKey}:checkout` : `${referenceId}:checkout`,
            customerId: customer.id,
            invoiceId: invoice?.id || null,
            fulfilledOrderId: order?.id || null,
            status: "pending_payment",
            purpose,
            gateway: gatewayPriority[0] || "razorpay",
            amount: gatewayAmount,
            currency: "INR",
            snapshot: {
              source: "direct_order_payment",
              orderId: order?.id || null,
              invoiceId: invoice?.id || null,
              referenceId,
              topupReference: purpose === "topup" ? referenceId : null,
            } as any,
          } as any,
        })
        const checkoutPayment = await getOrCreateCheckoutPayment({
          requestId,
          gateway: "razorpay",
          checkoutSessionId: checkoutSessionResult.session.id,
          gatewayConfig: razorpayConfig,
          customerDetails: {
            customerId: customer.id,
            customerEmail: normalizedSessionEmail,
            customerPhone: customerDetails.phone,
            customerName: customerDetails.name,
          },
          orderNote: purpose === "topup" ? "Wallet top-up" : productDisplayName(productData, customConfigData),
          returnUrl: razorpayUrls.returnUrl,
          webhookUrl: razorpayUrls.webhookUrl,
          invoiceNumber: invoice?.invoiceNumber || null,
          paymentData: {
            checkoutSessionId: checkoutSessionResult.session.id,
            orderId: order?.id || null,
            invoiceId: invoice?.id || null,
            customerId: customer.id,
            gateway: "razorpay",
            amount: gatewayAmount,
            currency: "INR",
            status: "created",
            purpose,
            topupReference: purpose === "topup" ? referenceId : null,
            walletAppliedAmount: walletApplied,
            gatewayAmount,
            idempotencyKey: `${referenceId}-razorpay-init`,
          },
          paymentAttemptData: {
            orderId: order?.id || null,
            invoiceId: invoice?.id || null,
            userId: customer.id,
            domainId: gatewayResolution?.domainConfig?.id || null,
            gatewayConfigId: razorpayConfig?.id || null,
            gateway: "razorpay",
            sourceDomain: gatewayResolution?.sourceDomain || null,
            approvedDomain: gatewayResolution?.approvedPaymentDomain || null,
            approvedPaymentDomain: gatewayResolution?.approvedPaymentDomain || null,
            merchantOrderId: referenceId,
            amount: gatewayAmount,
            currency: "INR",
            status: "created",
            mode: modeForGatewayConfig(razorpayConfig, gatewayResolution),
            returnUrl: razorpayUrls.returnUrl,
          },
        })
        const paymentRecord = checkoutPayment.payment
        const paymentAttempt = checkoutPayment.attempt
        const gatewayResponse = asRecord(paymentRecord.gatewayResponse)
        await recordGatewayAttempt({ orderId: order?.id, paymentId: paymentRecord.id, gateway: "razorpay", status: "success", requestId: paymentRecord.gatewayOrderId })
        const payload = paymentInitPayload({
          order,
          invoice,
          payment: paymentRecord,
          gateway: "razorpay",
          gatewayOrderId: paymentRecord.gatewayOrderId,
          paymentSessionId: paymentRecord.gatewaySessionId,
          paymentUrl: paymentAttempt?.redirectUrl || null,
          redirectUrl: paymentAttempt?.redirectUrl || null,
          amount: gatewayAmount,
          currency: "INR",
          mode: domainGatewayMode(gatewayResolution),
          statusUrl: paymentStatusUrl(paymentRecord.gatewayOrderId || referenceId),
          extra: {
            publicKey: publicGatewayRuntime(razorpayConfig).publicKey || undefined,
            checkoutSessionId: checkoutSessionResult.session.id,
            discountAmount,
            couponCode,
            walletAppliedAmount: walletApplied,
            gatewayAmount,
            verified: false,
            reason: checkoutPayment.reason || "gateway_initiated",
            message: checkoutPayment.message || "Opening secure Razorpay checkout...",
            reusedExistingPayment: Boolean(checkoutPayment.reused),
            status: checkoutPayment.status || "gateway_started",
            checkoutOptions: asRecord(gatewayResponse.checkout) || null,
            checkout_options: asRecord(gatewayResponse.checkout) || null,
            brandName: gatewayResponse.brandName || null,
            brandImage: gatewayResponse.brandImage || null,
            merchantName: gatewayResponse.brandName || null,
            razorpayFlow: gatewayResponse.razorpayFlow || "order",
            razorpayTraceId: gatewayResponse.razorpayTraceId || null,
            couponDiscountAmount: discountAmount,
            couponDiscountPercent: pricingSnapshot.discountPercent,
            taxAmount,
            payableToday: payableAmount,
          },
        })
        logPaymentInitResult({
          orderId: payload.orderId,
          invoiceId: payload.invoiceId,
          gateway: payload.gateway,
          gatewayOrderId: payload.gatewayOrderId,
          paymentSessionId: payload.paymentSessionId,
          redirectUrl: payload.redirectUrl,
        })
        return NextResponse.json(payload)
      } catch (razorpayError: any) {
        await recordGatewayAttempt({ orderId: order?.id, gateway: "razorpay", status: "failed", requestId: referenceId, ...safeGatewayError(razorpayError) })
        if (order) await prisma.order.update({ where: { id: order.id }, data: { status: "payment_failed" } }).catch(() => undefined)
        return apiError("PAYMENT_START_FAILED", razorpayError?.message || "Payment could not be started. Please try again.", 502)
      }
    }

    if (!gatewayPriority.includes("cashfree")) {
	      if (order) {
	        await prisma.order.update({
          where: { id: order.id },
          data: { status: "payment_failed" },
        })
      }
	      await logPaymentPanelEvent({
	        message: offerData ? "offer_payment_init_failed" : "payment_config_missing",
        level: "warn",
        customerId: customer.id,
        orderId: order?.id || null,
        metadata: { purpose, gatewayPriority },
      })
      return apiError("NO_GATEWAY_AVAILABLE", missingGatewayConfigMessage(gatewayResolution), 503)
    }

    if (paymentBypassEnabled && purpose !== "topup") {
      if (productionTestPaymentBlocked("bypass", cashfreeRuntime.mode)) {
        return apiError("test_payment_blocked", "Bypass payments are disabled in production.", 403)
      }
	      const bypassPayment = await prisma.payment.create({
	        data: {
	          orderId: order?.id,
	          invoiceId: invoice?.id,
	          customerId: customer.id,
          gateway: "bypass",
          amount: gatewayAmount,
          currency: "INR",
          status: "completed",
          purpose,
          topupReference: null,
          walletAppliedAmount: walletApplied,
          gatewayAmount,
          completedAt: new Date(),
          errorMessage: "Payment bypass enabled",
        },
      })
	      if (order) {
	        await prisma.order.update({ where: { id: order.id }, data: { status: "paid" } })
	        const paidInvoice = await createInvoiceForOrder(order.id, { paymentId: bypassPayment.id }).catch((error) => {
	          console.error("[Payments][Create] bypass invoice creation failed", { orderId: order.id, message: error?.message })
            return null
	        })
        await Promise.all([
          sendOrderInvoiceNotification({ templateKey: "order_paid", orderId: order.id, invoiceId: paidInvoice?.id || invoice?.id || null, metadata: { source: "payment_bypass" } }),
          sendOrderInvoiceNotification({ templateKey: "invoice_paid", orderId: order.id, invoiceId: paidInvoice?.id || invoice?.id || null, metadata: { source: "payment_bypass" } }),
        ]).catch((emailError) => {
          console.error("[Payments][Create] bypass payment email failed", { orderId: order.id, message: emailError?.message })
        })
	        if (isDedicatedCheckout) {
	          await markDedicatedPaymentConfirmed(order.id, "bypass")
	        } else if (shouldAutoProvision({ paymentSettings, paymentMode: cashfreeRuntime.paymentMode, walletCovered: false })) {
          try {
            if (purpose === "upgrade_order") {
              await enqueueUpgradeJob(order.id, "bypass")
            } else {
              await enqueueProvisioningJob(order.id, "bypass")
            }
          } catch (error: any) {
            console.error("[Payments][Create] bypass auto-provision enqueue failed", { orderId: order.id, message: error?.message })
          }
        }
      }
	      return NextResponse.json({
	        success: true,
	        ok: true,
	        verified: true,
          reason: "payment_bypass",
	        orderNumber: order?.orderNumber || referenceId,
	        invoiceId: invoice?.id || null,
	        paymentId: bypassPayment.id,
	        gateway: "bypass",
	        usedFallback: false,
	        statusUrl: paymentStatusUrl(referenceId),
        paymentMode: "bypass",
        amount: gatewayAmount,
        discountAmount,
        couponCode,
        couponDiscountAmount: discountAmount,
        couponDiscountPercent: pricingSnapshot.discountPercent,
        taxAmount,
        payableToday: payableAmount,
        walletAppliedAmount: walletApplied,
        gatewayAmount,
        ...(await orderRedirectPayload(order?.id)),
      })
    }

    if (cashfreeRuntime.paymentMode === "mock") {
      return apiError("razorpay_required", "Razorpay Standard Checkout must be configured before customer payments can be started.", 503)
    }

    // Create Cashfree payment order
    try {
      await recordGatewayAttempt({ orderId: order?.id, gateway: "cashfree", status: "started", requestId: referenceId })
      console.log("[Payments][Create] creating Cashfree order", {
        paymentMode: cashfreeRuntime.paymentMode,
        env: cashfreeRuntime.mode,
        referenceId,
        customerId: customer.id,
        customerEmail: normalizedSessionEmail,
        gatewayAmount,
        totalAmount: payableAmount,
        walletApplied,
        purpose,
        orderId: order?.id || null,
        term: parsedTerm,
      })

	      const cashfreeConfig = gatewayCandidates.find((config) => config.gateway === "cashfree") || configForGateway(gatewayResolution!, "cashfree")
	      const cashfreeUrls = urlsForGateway(gatewayResolution!, cashfreeConfig, referenceId, request)
	      const paymentOrder = await createDomainGatewayPaymentSession({
	        gateway: "cashfree",
	        orderId: referenceId,
	        amount: gatewayAmount,
	        customerDetails: {
	          customerId: customer.id,
	          customerEmail: normalizedSessionEmail,
	          customerPhone: customerDetails.phone,
	          customerName: customerDetails.name,
	        },
	        orderNote: purpose === "topup" ? "Wallet top-up" : productDisplayName(productData, customConfigData),
	        returnUrl: cashfreeUrls.returnUrl,
	        webhookUrl: cashfreeUrls.webhookUrl,
	        gatewayConfig: cashfreeConfig,
	      })

	      console.log("[Payments][Create] gateway response", {
        referenceId,
		        cfOrderId: paymentOrder.gatewayOrderId,
	        orderStatus: (paymentOrder.raw as any)?.orderStatus || null,
	        hasPaymentSessionId: Boolean(paymentOrder.gatewaySessionId),
	        hasPaymentUrl: Boolean(paymentOrder.redirectUrl),
	        orderAmount: gatewayAmount,
		      })
		      const cashfreeRedirectUrl = paymentOrder.redirectUrl || null
		      if (!paymentOrder.gatewaySessionId && !cashfreeRedirectUrl) {
	        throw Object.assign(new Error("Payment gateway did not return a checkout session."), { code: "PAYMENT_INIT_FAILED" })
	      }

	      // Create payment record
	      const paymentRecord = await prisma.payment.create({
	        data: {
	          orderId: order?.id,
	          invoiceId: invoice?.id,
	          customerId: customer.id,
	          gateway: "cashfree",
	          gatewayOrderId: paymentOrder.gatewayOrderId,
	          gatewayPaymentId: paymentOrder.gatewayPaymentId,
	          transactionId: paymentOrder.gatewayTransactionId,
	          gatewayTransactionId: paymentOrder.gatewayTransactionId,
	          gatewaySessionId: paymentOrder.gatewaySessionId,
          amount: gatewayAmount,
          currency: "INR",
          status: "pending",
          purpose,
          topupReference: purpose === "topup" ? referenceId : null,
          walletAppliedAmount: walletApplied,
          gatewayAmount,
          idempotencyKey: `${referenceId}-init`,
        },
	      })
	      const paymentAttempt = await prisma.paymentAttempt.create({
	        data: {
	          orderId: order?.id,
	          invoiceId: invoice?.id,
	          paymentId: paymentRecord.id,
	          userId: customer.id,
	          domainId: gatewayResolution?.domainConfig?.id || null,
	          gatewayConfigId: cashfreeConfig?.id || null,
	          gateway: "cashfree",
	          sourceDomain: gatewayResolution?.sourceDomain || null,
	          approvedDomain: gatewayResolution?.approvedPaymentDomain || null,
	          approvedPaymentDomain: gatewayResolution?.approvedPaymentDomain || null,
	          merchantOrderId: referenceId,
	          gatewayOrderId: paymentOrder.gatewayOrderId,
	          gatewayPaymentId: paymentOrder.gatewayPaymentId,
	          gatewayTransactionId: paymentOrder.gatewayTransactionId,
	          amount: gatewayAmount,
	          currency: "INR",
	          status: "started",
	          mode: modeForGatewayConfig(cashfreeConfig, gatewayResolution),
	          redirectUrl: cashfreeRedirectUrl,
	          returnUrl: cashfreeUrls.returnUrl,
	          rawGatewayResponse: paymentOrder.raw as any,
	        },
	      }).catch(() => null)
	      await logGatewayDecision({
	        resolution: gatewayResolution,
	        selectedConfig: cashfreeConfig,
	        customerId: customer.id,
	        orderId: order?.id || null,
	        paymentAttemptId: paymentAttempt?.id || null,
	        message: "payment_gateway_resolution_decision",
	        extra: { purpose, merchantOrderId: referenceId },
	      })
	      await recordGatewayAttempt({ orderId: order?.id, paymentId: paymentRecord.id, gateway: "cashfree", status: "success", requestId: paymentOrder.gatewayOrderId })
	      if (offerData) {
	        await logPaymentPanelEvent({
	          message: "payment_session_created",
	          level: "info",
	          customerId: customer.id,
	          orderId: order?.id || null,
		          metadata: { offerId: offerData.id, gateway: "cashfree", paymentId: paymentRecord.id, hasRedirectUrl: Boolean(cashfreeRedirectUrl), hasSessionId: Boolean(paymentOrder.gatewaySessionId) },
	        })
	      }

      if (order) {
        await prisma.order.update({
          where: { id: order.id },
          data: {
	            cashfreeOrderId: paymentOrder.gatewayOrderId,
	            cashfreePaymentSessionId: paymentOrder.gatewaySessionId,
	          },
	        })
	      }
	      if (offerData) {
	        await logPaymentPanelEvent({
	          message: "payment_redirect_returned",
	          level: "info",
	          customerId: customer.id,
	          orderId: order?.id || null,
	          metadata: { offerId: offerData.id, gateway: "cashfree", paymentId: paymentRecord.id },
	        })
	      }

	      const payload = paymentInitPayload({
	        order,
	        invoice,
	        payment: paymentRecord,
	        gateway: "cashfree",
	        gatewayOrderId: paymentOrder.gatewayOrderId,
	        paymentSessionId: paymentOrder.gatewaySessionId,
	        paymentUrl: cashfreeRedirectUrl,
	        redirectUrl: cashfreeRedirectUrl,
	        amount: gatewayAmount,
	        currency: "INR",
	        mode: cashfreeRuntime.mode,
	        statusUrl: paymentStatusUrl(paymentOrder.gatewayOrderId || referenceId),
	        extra: {
	          discountAmount,
	          couponCode,
	          walletAppliedAmount: walletApplied,
	          gatewayAmount,
	          verified: false,
	          reason: "gateway_initiated",
	          pricingMeta: fixedPricingMeta ? {
	            calculatedMonthlyPrice: fixedPricingMeta.calculatedMonthlyPrice,
	            productMonthlyPrice: fixedPricingMeta.productMonthlyPrice,
	            fixedDiscountAmount: fixedPricingMeta.fixedDiscountAmount,
	            fixedDiscountPercent: fixedPricingMeta.fixedDiscountPercent,
	          } : null,
	          couponDiscountAmount: discountAmount,
	          couponDiscountPercent: pricingSnapshot.discountPercent,
	          taxAmount,
	          payableToday: payableAmount,
	        },
	      })
	      logPaymentInitResult({
	        orderId: payload.orderId,
	        invoiceId: payload.invoiceId,
	        gateway: payload.gateway,
	        gatewayOrderId: payload.gatewayOrderId,
	        paymentSessionId: payload.paymentSessionId,
	        redirectUrl: payload.redirectUrl,
	      })
	      return NextResponse.json(payload)
    } catch (paymentError: any) {
      await recordGatewayAttempt({
        orderId: order?.id,
        gateway: "cashfree",
	        status: !explicitGatewaySelected && gatewayPriority.includes("phonepe") ? "fallback" : "failed",
        requestId: referenceId,
        ...safeGatewayError(paymentError),
      })
      // Roll back wallet debit when gateway order initialization fails.
      if (walletApplied > 0 && purpose !== "topup") {
        try {
          await prisma.$transaction(async (tx) => {
            const existingRefund = await tx.walletTransaction.findFirst({
              where: {
                customerId: customer.id,
                type: "refund",
                referenceId: `${walletReference}-gateway-init-failed`,
              },
            })
            if (!existingRefund) {
              const fresh = await tx.customer.findUnique({
                where: { id: customer.id },
                select: { walletBalance: true },
              })
              const balanceBefore = Number(fresh?.walletBalance || 0)
              const balanceAfter = Number((balanceBefore + walletApplied).toFixed(2))

              await tx.customer.update({
                where: { id: customer.id },
                data: {
                  walletBalance: {
                    increment: walletApplied,
                  },
                },
              })
              await tx.walletTransaction.create({
                data: {
                  customerId: customer.id,
                  type: "refund",
                  amount: walletApplied,
                  balanceBefore,
                  balanceAfter,
                  status: "completed",
                  reason: "Gateway initialization failed; wallet debit reversed",
                  referenceId: `${walletReference}-gateway-init-failed`,
                  createdByType: "system",
                },
              })
            }
          })
        } catch (rollbackError) {
          console.error("Failed to roll back wallet debit after gateway init error:", rollbackError)
        }
      }

if (!explicitGatewaySelected && gatewayPriority.includes("phonepe")) {
        try {
          const fallbackGatewayAmount = Number((gatewayAmount + walletApplied).toFixed(2))
	          const phonepeConfig = gatewayCandidates.find((config) => config.gateway === "phonepe") || configForGateway(gatewayResolution!, "phonepe")
	          const phonepeUrls = urlsForGateway(gatewayResolution!, phonepeConfig, referenceId, request)
	          const phonepeOrder = await createDomainGatewayPaymentSession({
	            gateway: "phonepe",
	            orderId: referenceId,
	            amount: fallbackGatewayAmount,
            customerDetails: {
              customerId: customer.id,
              customerEmail: normalizedSessionEmail,
              customerPhone: customerDetails.phone,
              customerName: customerDetails.name,
	            },
	            orderNote: purpose === "topup" ? "Wallet top-up" : productDisplayName(productData, customConfigData),
	            returnUrl: phonepeUrls.returnUrl,
	            webhookUrl: phonepeUrls.webhookUrl,
	            gatewayConfig: phonepeConfig,
	          })
          const paymentRecord = await prisma.payment.create({
	            data: {
	              orderId: order?.id,
	              invoiceId: invoice?.id,
	              customerId: customer.id,
	              gateway: "phonepe",
	              gatewayOrderId: phonepeOrder.gatewayOrderId,
	              gatewayPaymentId: phonepeOrder.gatewayPaymentId,
	              transactionId: phonepeOrder.gatewayTransactionId,
	              gatewayTransactionId: phonepeOrder.gatewayTransactionId,
	              gatewaySessionId: phonepeOrder.gatewaySessionId,
              amount: fallbackGatewayAmount,
              currency: "INR",
              status: "pending",
              purpose,
              topupReference: purpose === "topup" ? referenceId : null,
              walletAppliedAmount: 0,
              gatewayAmount: fallbackGatewayAmount,
              idempotencyKey: `${referenceId}-phonepe-fallback-init`,
	              gatewayResponse: phonepeOrder.raw as any,
	            },
	          })
	          const paymentAttempt = await prisma.paymentAttempt.create({
	            data: {
	              orderId: order?.id,
	              invoiceId: invoice?.id,
	              paymentId: paymentRecord.id,
	              userId: customer.id,
	              domainId: gatewayResolution?.domainConfig?.id || null,
	              gatewayConfigId: phonepeConfig?.id || null,
	              gateway: "phonepe",
	              sourceDomain: gatewayResolution?.sourceDomain || null,
	              approvedDomain: gatewayResolution?.approvedPaymentDomain || null,
	              approvedPaymentDomain: gatewayResolution?.approvedPaymentDomain || null,
	              merchantOrderId: referenceId,
	              gatewayOrderId: phonepeOrder.gatewayOrderId,
	              gatewayPaymentId: phonepeOrder.gatewayPaymentId,
	              gatewayTransactionId: phonepeOrder.gatewayTransactionId,
	              amount: fallbackGatewayAmount,
	              currency: "INR",
	              status: "started",
	              mode: modeForGatewayConfig(phonepeConfig, gatewayResolution),
	              redirectUrl: phonepeOrder.redirectUrl,
	              returnUrl: phonepeUrls.returnUrl,
	              rawGatewayResponse: phonepeOrder.raw as any,
	            },
	          }).catch(() => null)
	          await logGatewayDecision({
	            resolution: gatewayResolution,
	            selectedConfig: phonepeConfig,
	            customerId: customer.id,
	            orderId: order?.id || null,
	            paymentAttemptId: paymentAttempt?.id || null,
	            message: "payment_gateway_resolution_decision",
	            extra: { purpose, merchantOrderId: referenceId, usedFallback: true },
	          })
	          await recordGatewayAttempt({ orderId: order?.id, paymentId: paymentRecord.id, gateway: "phonepe", status: "success", requestId: phonepeOrder.gatewayOrderId })
	          return NextResponse.json({
	            success: true,
	            ok: true,
	            orderNumber: order?.orderNumber || referenceId,
	            orderId: order?.id || null,
	            invoiceId: invoice?.id || null,
	            gatewayOrderId: phonepeOrder.gatewayOrderId,
	            paymentUrl: phonepeOrder.redirectUrl,
	            redirectUrl: phonepeOrder.redirectUrl,
	            statusUrl: paymentStatusUrl(referenceId),
            amount: fallbackGatewayAmount,
            currency: "INR",
            discountAmount,
            couponCode,
            couponDiscountAmount: discountAmount,
            couponDiscountPercent: pricingSnapshot.discountPercent,
            taxAmount,
            payableToday: payableAmount,
            walletAppliedAmount: 0,
            gatewayAmount: fallbackGatewayAmount,
            gateway: "phonepe",
            usedFallback: true,
            verified: false,
            reason: "phonepe_fallback",
            paymentId: paymentRecord.id,
          })
        } catch (phonepeError: any) {
          console.error("[Payments][Create] PhonePe fallback failed", {
            referenceId,
            message: phonepeError?.message,
          })
	      await logPaymentPanelEvent({
	        message: offerData ? "offer_payment_init_failed" : "payment_create_failed",
            level: "error",
            customerId: customer.id,
            orderId: order?.id || null,
            metadata: { gateway: "phonepe", phase: "fallback", message: phonepeError?.message || null },
          })
        }
      }

      // Update order status to failed
      if (order) {
        await prisma.order.update({
          where: { id: order.id },
          data: { status: "payment_failed" },
        })
      }

	      const isGatewayError = paymentError instanceof CashfreeGatewayError
	      const safeCode = paymentError?.code === "PAYMENT_INIT_FAILED" ? "PAYMENT_INIT_FAILED" : isGatewayError ? paymentError.safeCode : "gateway_rejected"
	      const safeMessage = isGatewayError
	        ? paymentError.safeMessage
	        : paymentError?.code === "PAYMENT_INIT_FAILED"
	          ? "Payment could not be started. Please try again or pay from your invoice."
	          : "Payment gateway rejected request. Please try again."
	      const safeStatus = paymentError?.code === "PAYMENT_INIT_FAILED" ? 502 : isGatewayError ? paymentError.statusCode : 502

      console.error("[Payments][Create] Cashfree payment error", {
        code: safeCode,
        safeMessage,
        status: safeStatus,
        orderId: order?.id || null,
        referenceId,
        details: isGatewayError
          ? paymentError.details
          : {
              message: paymentError?.message,
              responseStatus: paymentError?.response?.status || null,
              responseBody: paymentError?.response?.data || paymentError?.response || null,
            },
      })
      if (safeCode === "gateway_not_ready") {
        return paymentInitFailure("Payment gateway not ready. Please try again later.")
      }
	      await logPaymentPanelEvent({
	        message: offerData ? "offer_payment_init_failed" : "payment_create_failed",
        level: "error",
        customerId: customer.id,
        orderId: order?.id || null,
        metadata: { gateway: "cashfree", code: safeCode, status: safeStatus },
      })
      return paymentInitFailure(safeMessage)
    }
  } catch (error: any) {
    trace.fail(currentCheckoutStage || "fatal", error)
    logCheckoutFatal(error, requestId, currentCheckoutStage || "fatal")
    await logPaymentPanelEvent({
      message: "payment_create_failed",
      level: "error",
      metadata: {
        requestId,
        stage: currentCheckoutStage || "fatal",
        code: error?.code || null,
        message: error?.message || null,
        technical: classifyCheckoutError(error, currentCheckoutStage || "fatal").technical as any,
      },
    })
    if (error?.code === "wallet_insufficient") {
      return apiError("wallet_insufficient", error.message || "Insufficient wallet balance.", 400)
    }
    if (error?.code === "billing_address_required") {
      return NextResponse.json({
        ok: false,
        success: false,
        code: "billing_address_required",
        error: error.message || "Billing address is required before payment.",
        missingFields: Array.isArray(error?.fields) ? error.fields : undefined,
      }, { status: 400 })
    }
    if (String(error?.code || "").startsWith("PRICE_TOKEN") || error?.code === "INVALID_PRICE_TOKEN") {
      return apiError(String(error.code || "pricing_token_invalid").toLowerCase(), error.message || "Refresh checkout pricing before payment.", error.status || 409)
    }
    return checkoutTechnicalErrorResponse({
      error,
      requestId,
      stage: currentCheckoutStage || "fatal",
      status: /^P\d/.test(String(error?.code || "")) ? 500 : undefined,
    })
  }
}
