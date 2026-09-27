import type { NextRequest } from "next/server"
import { Prisma, type PrismaClient } from "@prisma/client"
import { prisma } from "@/lib/db"
import { createDomainGatewayPaymentSession, gatewayCredentials } from "@/lib/payment-gateways"
import { getGatewayConfigForGateway, getUsableGatewayCandidates, resolvePaymentGateway, type ResolvedPaymentGateway } from "@/lib/payments/domain-gateway-resolver"
import { paymentWebhookUrl } from "@/lib/runtime-site-url"
import { recordGatewayAttempt, safeGatewayError } from "@/lib/payment-attempts"
import { createWalletTransaction } from "@/lib/wallet"
import { withRedisLock } from "@/lib/redis"
import { computeGatewayFee } from "@/lib/billing/gateway-fee"

type DbClient = PrismaClient | Prisma.TransactionClient

export const WALLET_TOPUP_PURPOSE = "wallet_topup"
export const LEGACY_WALLET_TOPUP_PURPOSE = "topup"
export const WALLET_TOPUP_PURPOSES = new Set([WALLET_TOPUP_PURPOSE, LEGACY_WALLET_TOPUP_PURPOSE])

export function isWalletTopupPurpose(value: unknown) {
  return WALLET_TOPUP_PURPOSES.has(String(value || "").toLowerCase())
}

export function normalizeWalletTopupAmount(value: unknown) {
  const amount = typeof value === "number" ? value : Number(String(value ?? "").trim())
  if (!Number.isFinite(amount)) return null
  return Number(amount.toFixed(2))
}

export function resolveMinimumWalletTopupAmount(input: {
  billingPricing?: Record<string, unknown> | null
  paymentSettings?: Record<string, unknown> | null
}) {
  const billingMinimum = Number(input.billingPricing?.minimumWalletTopupAmount ?? (input.billingPricing as any)?.minimum_wallet_topup_amount)
  if (Number.isFinite(billingMinimum) && billingMinimum > 0) return Number(billingMinimum.toFixed(2))

  const legacyMinimum = Number(input.paymentSettings?.walletTopupMinimumAmount)
  if (Number.isFinite(legacyMinimum) && legacyMinimum > 0) return Number(legacyMinimum.toFixed(2))

  return 100
}

export function generateWalletTopupReference() {
  const timestamp = Date.now().toString(36).toUpperCase()
  const random = Math.random().toString(36).substring(2, 7).toUpperCase()
  return `TOPUP-${timestamp}-${random}`
}

export function walletTopupInvoiceNumber(referenceId: string) {
  return `INV-${referenceId.replace(/[^a-zA-Z0-9-]/g, "").replace(/^-+/, "")}`
}

function decimal(value: number) {
  return new Prisma.Decimal(value.toFixed(2))
}

function gatewayRequiredCredentials(gateway: string) {
  if (gateway === "razorpay") return ["keyId", "keySecret", "webhookSecret"]
  if (gateway === "cashfree") return ["appId", "secretKey"]
  if (gateway === "phonepe") return ["merchantId", "clientId", "clientSecret", "clientVersion"]
  return []
}

function domainGatewayReady(config: any) {
  if (!config?.enabled) return false
  const credentials = gatewayCredentials(config)
  return gatewayRequiredCredentials(config.gateway).every((key) => Boolean(credentials[key]))
}

function filterUsableTopupGateways(resolution: ResolvedPaymentGateway | null) {
  if (!resolution) return []
  return getUsableGatewayCandidates(resolution, "card_upi")
    .filter(domainGatewayReady)
    .map((config) => config.gateway)
}

function configForGateway(resolution: ResolvedPaymentGateway, gateway: string) {
  const config = getGatewayConfigForGateway(resolution, gateway)
  if (config) return config
  if (resolution.gatewayConfig?.gateway === gateway) return resolution.gatewayConfig
  return resolution.gatewayConfig
}

function urlsForGateway(resolution: ResolvedPaymentGateway, config: any, merchantOrderId: string) {
  const baseUrl = String(resolution.approvedBaseUrl || resolution.baseUrl)
  const replace = (value: string) => value.replace(/\{order_id\}/g, encodeURIComponent(merchantOrderId))
  return {
    returnUrl: replace(String(config?.returnUrl || `${baseUrl}/payment/status?order_id={order_id}`)),
    webhookUrl: replace(String(config?.webhookUrl || paymentWebhookUrl(config?.gateway || resolution.gateway, baseUrl))),
  }
}

function noGatewayMessage(resolution: ResolvedPaymentGateway | null) {
  if (!resolution) return "Payment gateway configuration could not be resolved for this domain. Please contact support."
  const defaultGateway = resolution.defaultGateway || resolution.gatewayConfig?.gateway || "none"
  return `No usable payment gateway is configured for ${resolution.sourceDomain}. Default gateway: ${defaultGateway}. Please contact support.`
}

function getGatewaySpecificFields(gateway: string, checkoutOptions: any, gatewayResponse: any, gatewayOrderId: string) {
  const fields: Record<string, any> = {}
  if (gateway === "razorpay") {
    fields.checkoutOptions = checkoutOptions
    fields.checkout_options = checkoutOptions
    fields.publicKey = checkoutOptions?.key || gatewayResponse.keyId
    fields.razorpayOrderId = checkoutOptions?.order_id || gatewayOrderId
    fields.razorpay_order_id = checkoutOptions?.order_id || gatewayOrderId
    fields.razorpayFlow = gatewayResponse.razorpayFlow || "order"
  }
  if (gateway === "cashfree") {
    fields.cashfreeOrderId = checkoutOptions?.order_id || gatewayOrderId
    fields.cashfree_order_id = checkoutOptions?.order_id || gatewayOrderId
    fields.cfOrderId = checkoutOptions?.order_id || gatewayOrderId
    fields.paymentSessionId = gatewayResponse.payment_session_id
  }
  if (gateway === "phonepe") {
    fields.phonepeOrderId = checkoutOptions?.order_id || gatewayOrderId
    fields.phonepe_order_id = checkoutOptions?.order_id || gatewayOrderId
    fields.merchantOrderId = gatewayResponse.merchantOrderId
  }
  return fields
}

export function walletTopupInitPayload(input: {
  invoice?: any | null
  payment: any
  gateway: string
  gatewayOrderId?: string | null
  paymentSessionId?: string | null
  paymentUrl?: string | null
  redirectUrl?: string | null
  amount: number
  mode?: string | null
  reusedExistingPayment?: boolean
}) {
  const gateway = String(input.gateway || "").toLowerCase()
  const gatewayResponse = input.payment?.gatewayResponse && typeof input.payment.gatewayResponse === "object" && !Array.isArray(input.payment.gatewayResponse)
    ? input.payment.gatewayResponse as Record<string, any>
    : {}
  const checkoutOptions = gatewayResponse.checkout && typeof gatewayResponse.checkout === "object" && !Array.isArray(gatewayResponse.checkout)
    ? gatewayResponse.checkout
    : null
  const paymentUrl = input.paymentUrl || null
  const redirectUrl = input.redirectUrl || paymentUrl
  const statusUrl = `/payment/status?order_id=${encodeURIComponent(input.gatewayOrderId || input.payment.gatewayOrderId || input.payment.topupReference || input.payment.id)}`
  const gatewaySpecific = getGatewaySpecificFields(gateway, checkoutOptions, gatewayResponse, input.gatewayOrderId || input.payment.gatewayOrderId || input.payment.topupReference || input.payment.id)
  const isRetry = input.reusedExistingPayment
  return {
    ok: true,
    success: true,
    invoiceId: input.invoice?.id || null,
    paymentId: input.payment.id,
    gateway: input.gateway,
    gatewayOrderId: input.gatewayOrderId || input.payment.gatewayOrderId || null,
    paymentSessionId: input.paymentSessionId || input.payment.gatewaySessionId || null,
    payment_session_id: input.paymentSessionId || input.payment.gatewaySessionId || null,
    paymentUrl,
    payment_url: paymentUrl,
    checkout_url: paymentUrl,
    redirectUrl,
    statusUrl,
    amount: Number(input.amount || 0),
    currency: input.payment.currency || "INR",
    mode: input.mode || null,
    purpose: WALLET_TOPUP_PURPOSE,
    reusedExistingPayment: isRetry,
    ...gatewaySpecific,
    message: isRetry ? "Resuming existing payment..." : `Opening secure ${gateway.charAt(0).toUpperCase() + gateway.slice(1)} checkout...`,
    status: isRetry ? "resuming" : "gateway_started",
  }
}

export async function createWalletTopupPayment(input: {
  request: NextRequest
  customer: { id: string; email: string; name?: string | null; phone?: string | null }
  amount: number
  preferredGateway?: string | null
}) {
  const recentSince = new Date(Date.now() - 60 * 60 * 1000)
  const reusable = await prisma.payment.findFirst({
    where: {
      customerId: input.customer.id,
      purpose: { in: [WALLET_TOPUP_PURPOSE, LEGACY_WALLET_TOPUP_PURPOSE] },
      status: { in: ["created", "pending", "pending_manual"] },
      amount: {
        gte: decimal(Number((input.amount - 0.01).toFixed(2))),
        lte: decimal(Number((input.amount + 0.01).toFixed(2))),
      },
      createdAt: { gte: recentSince },
      OR: [
        { gatewaySessionId: { not: null } },
        { gatewayOrderId: { not: null } },
      ],
    },
    include: { invoice: true, paymentAttempts: { orderBy: { createdAt: "desc" }, take: 1 } },
    orderBy: { createdAt: "desc" },
  }).catch(() => null)

  if (reusable) {
    const attempt = reusable.paymentAttempts[0]
    return walletTopupInitPayload({
      invoice: reusable.invoice || null,
      payment: reusable,
      gateway: reusable.gateway,
      gatewayOrderId: reusable.gatewayOrderId,
      paymentSessionId: reusable.gatewaySessionId,
      paymentUrl: attempt?.redirectUrl || null,
      redirectUrl: attempt?.redirectUrl || null,
      amount: Number(reusable.gatewayAmount || reusable.amount || input.amount),
      mode: attempt?.mode || null,
      reusedExistingPayment: true,
    })
  }

  const referenceId = generateWalletTopupReference()
  const resolution = await resolvePaymentGateway({
    request: input.request,
    preferredGateway: input.preferredGateway || null,
    amount: input.amount,
    merchantOrderId: referenceId,
  }).catch((error) => {
    throw Object.assign(new Error(error?.message || "Payment gateway configuration could not be resolved."), {
      code: error?.code || "NO_GATEWAY_AVAILABLE",
      status: error?.status || 503,
    })
  })
  const gatewayPriority = filterUsableTopupGateways(resolution)
  if (!gatewayPriority.length) {
    throw Object.assign(new Error(noGatewayMessage(resolution)), { code: "NO_GATEWAY_AVAILABLE", status: 503 })
  }

  const checkoutSession = await prisma.checkoutSession.create({
    data: {
      referenceId,
      customerId: input.customer.id,
      status: "pending",
      purpose: WALLET_TOPUP_PURPOSE,
      gateway: gatewayPriority[0],
      amount: decimal(input.amount),
      currency: "INR",
      snapshot: {
        kind: WALLET_TOPUP_PURPOSE,
        customer: {
          id: input.customer.id,
          email: input.customer.email,
          phone: input.customer.phone || null,
        },
        amount: input.amount,
        currency: "INR",
      },
    },
  })

  const startGateway = async (gateway: string, usedFallback: boolean) => {
    const gatewayConfig = configForGateway(resolution, gateway)
    const urls = urlsForGateway(resolution, gatewayConfig, referenceId)
    await recordGatewayAttempt({ gateway, status: "started", requestId: referenceId, metadata: { purpose: WALLET_TOPUP_PURPOSE } })
    const session = await createDomainGatewayPaymentSession({
      gateway,
      orderId: referenceId,
      amount: input.amount,
      customerDetails: {
        customerId: input.customer.id,
        customerEmail: input.customer.email,
        customerPhone: input.customer.phone || "9999999999",
        customerName: input.customer.name || "Client",
      },
      orderNote: "Wallet top-up",
      returnUrl: urls.returnUrl,
      webhookUrl: urls.webhookUrl,
      gatewayConfig,
      invoiceNumber: referenceId,
    })
    const payment = await prisma.payment.create({
      data: {
        checkoutSessionId: checkoutSession.id,
        invoiceId: null,
        customerId: input.customer.id,
        gateway,
        gatewayOrderId: session.gatewayOrderId,
        gatewayPaymentId: session.gatewayPaymentId,
        transactionId: session.gatewayTransactionId,
        gatewayTransactionId: session.gatewayTransactionId,
        gatewaySessionId: session.gatewaySessionId,
        amount: decimal(input.amount),
        currency: "INR",
        status: "pending",
        purpose: WALLET_TOPUP_PURPOSE,
        topupReference: referenceId,
        walletAppliedAmount: decimal(0),
        gatewayAmount: decimal(input.amount),
        idempotencyKey: `${referenceId}-${gateway}-init`,
        gatewayResponse: session.raw as any,
      },
    })
    await prisma.paymentAttempt.create({
      data: {
        invoiceId: null,
        paymentId: payment.id,
        userId: input.customer.id,
        domainId: resolution.domainConfig?.id || null,
        gatewayConfigId: gatewayConfig?.id || null,
        gateway,
        sourceDomain: resolution.sourceDomain || null,
        approvedDomain: resolution.approvedPaymentDomain || null,
        approvedPaymentDomain: resolution.approvedPaymentDomain || null,
        merchantOrderId: referenceId,
        gatewayOrderId: session.gatewayOrderId,
        gatewayPaymentId: session.gatewayPaymentId,
        gatewayTransactionId: session.gatewayTransactionId,
        amount: decimal(input.amount),
        currency: "INR",
        status: "started",
        mode: resolution.mode || "direct",
        redirectUrl: session.redirectUrl,
        returnUrl: urls.returnUrl,
        rawGatewayResponse: session.raw as any,
      },
    }).catch(() => null)
    await recordGatewayAttempt({ paymentId: payment.id, gateway, status: "success", requestId: session.gatewayOrderId, metadata: { purpose: WALLET_TOPUP_PURPOSE, usedFallback } })
    return walletTopupInitPayload({
      invoice: null,
      payment,
      gateway,
      gatewayOrderId: session.gatewayOrderId,
      paymentSessionId: session.gatewaySessionId,
      paymentUrl: session.redirectUrl,
      redirectUrl: session.redirectUrl,
      amount: input.amount,
      mode: String(gatewayConfig?.environment || "sandbox").toLowerCase() === "production" ? "production" : "sandbox",
    })
  }

  const primary = gatewayPriority[0]
  try {
    return await startGateway(primary, false)
  } catch (error: any) {
    await recordGatewayAttempt({ gateway: primary, status: "failed", requestId: referenceId, ...safeGatewayError(error), metadata: { purpose: WALLET_TOPUP_PURPOSE } })
    const fallback = gatewayPriority.find((gateway) => gateway !== primary)
    if (fallback) return startGateway(fallback, true)
    await prisma.checkoutSession.update({ where: { id: checkoutSession.id }, data: { status: "payment_failed" } }).catch(() => undefined)
    throw Object.assign(new Error(error?.safeMessage || error?.message || "Payment could not be started. Please try again."), {
      code: error?.safeCode || error?.code || "PAYMENT_START_FAILED",
      status: error?.statusCode || 502,
    })
  }
}

export async function finalizeWalletTopupPayment(input: {
  paymentAttemptId?: string | null
  paymentId?: string | null
  paidAmount: number
  currency?: string | null
  merchantOrderId?: string | null
  gatewayOrderId?: string | null
  customerId?: string | null
  gatewayPaymentId?: string | null
  gatewayTransactionId?: string | null
  bankReferenceId?: string | null
  paymentMethod?: string | null
  gatewayResponse?: unknown
  actor?: string
}) {
  const actor = input.actor || "system"
  const lockId = input.paymentAttemptId || input.paymentId || `wallet-topup:${input.gatewayOrderId || input.merchantOrderId || "unknown"}`
  return withRedisLock(`wallet-credit-lock:${lockId}`, 20000, async () => prisma.$transaction(async (tx) => {
    const attempt = input.paymentAttemptId
      ? await tx.paymentAttempt.findUnique({
        where: { id: input.paymentAttemptId },
        include: { payment: { include: { invoice: true, customer: true, checkoutSession: true } } },
      })
      : null
    const payment = attempt?.payment
      ? attempt.payment
      : input.paymentId
        ? await tx.payment.findUnique({
          where: { id: input.paymentId },
          include: { invoice: true, customer: true, checkoutSession: true, paymentAttempts: { orderBy: { createdAt: "desc" }, take: 1 } },
        })
        : null
    const selectedAttempt = attempt || (payment as any)?.paymentAttempts?.[0] || null
    if (!payment || !selectedAttempt || !isWalletTopupPurpose(payment.purpose) || !payment.customerId) {
      return { finalized: false, result: "unpaid", reason: "wallet_topup_payment_not_found" }
    }

    const expectedAmount = Number(payment.gatewayAmount || payment.amount || 0)
    const paidAmount = Number(Number(input.paidAmount || 0).toFixed(2))
    const expectedCurrency = String(payment.currency || "INR").toUpperCase()
    const paidCurrency = String(input.currency || expectedCurrency).toUpperCase()
    const merchantOrderId = String(selectedAttempt.merchantOrderId || payment.topupReference || "").trim()
    const gatewayOrderId = String(selectedAttempt.gatewayOrderId || payment.gatewayOrderId || merchantOrderId || "").trim()
    const inputMerchantOrderId = String(input.merchantOrderId || "").trim()
    const inputGatewayOrderId = String(input.gatewayOrderId || "").trim()
    const inputCustomerId = String(input.customerId || "").trim()

    if (inputMerchantOrderId && merchantOrderId && inputMerchantOrderId !== merchantOrderId) {
      return { finalized: false, result: "failed", reason: "merchant_order_mismatch" }
    }
    if (inputGatewayOrderId && gatewayOrderId && inputGatewayOrderId !== gatewayOrderId) {
      return { finalized: false, result: "failed", reason: "gateway_order_mismatch" }
    }
    if (inputCustomerId && inputCustomerId !== String(payment.customerId)) {
      return { finalized: false, result: "failed", reason: "customer_mismatch" }
    }
    if (!merchantOrderId.startsWith("TOPUP-")) {
      return { finalized: false, result: "failed", reason: "invalid_merchant_order_id" }
    }
    if (!Number.isFinite(paidAmount) || Math.abs(paidAmount - expectedAmount) > 0.009 || paidCurrency !== expectedCurrency) {
      return { finalized: false, result: "amount_mismatch", reason: "amount_or_currency_mismatch" }
    }

    const referenceId = payment.topupReference || payment.gatewayOrderId || payment.id
    const existing = await tx.walletTransaction.findFirst({
      where: {
        type: { in: ["CREDIT_TOPUP", "topup"] },
        paymentAttemptId: selectedAttempt.id,
      },
    })

    const transactionId = input.gatewayTransactionId || input.gatewayPaymentId || payment.gatewayTransactionId || payment.gatewayPaymentId || null
    const wasFinalized = ["completed", "paid", "success", "verification_pending"].includes(String(payment.status || "").toLowerCase())
    const updatedPayment = await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: "completed",
        gatewayPaymentId: input.gatewayPaymentId || payment.gatewayPaymentId,
        transactionId: transactionId || payment.transactionId,
        gatewayTransactionId: transactionId || payment.gatewayTransactionId,
        paymentMethod: input.paymentMethod || payment.paymentMethod,
        gatewayResponse: input.gatewayResponse === undefined ? payment.gatewayResponse as any : input.gatewayResponse as any,
        completedAt: payment.completedAt || new Date(),
        webhookProcessedAt: payment.webhookProcessedAt || new Date(),
      },
    })
    if ((payment as any).checkoutSessionId) {
      await tx.checkoutSession.update({
        where: { id: (payment as any).checkoutSessionId },
        data: {
          status: "fulfilled",
          paidAt: new Date(),
          fulfilledAt: new Date(),
        },
      }).catch(() => undefined)
    }
    await tx.paymentAttempt.update({
      where: { id: selectedAttempt.id },
      data: {
        status: "success",
        gatewayOrderId: input.gatewayOrderId || selectedAttempt.gatewayOrderId || payment.gatewayOrderId || null,
        gatewayPaymentId: input.gatewayPaymentId || selectedAttempt.gatewayPaymentId || payment.gatewayPaymentId || null,
        gatewayTransactionId: transactionId || selectedAttempt.gatewayTransactionId,
        bankReferenceId: input.bankReferenceId || selectedAttempt.bankReferenceId,
        webhookVerifiedAt: selectedAttempt.webhookVerifiedAt || new Date(),
        statusCheckedAt: new Date(),
        rawGatewayResponse: input.gatewayResponse === undefined ? selectedAttempt.rawGatewayResponse as any : input.gatewayResponse as any,
        failureCode: null,
        failureMessage: null,
      },
    }).catch(() => undefined)

    if (payment.invoiceId) {
      await tx.invoice.update({
        where: { id: payment.invoiceId },
        data: {
          status: "paid",
          paidAt: payment.invoice?.paidAt || new Date(),
          paymentTransactionId: transactionId || payment.gatewayPaymentId || payment.gatewayOrderId || null,
          metadata: {
            ...((payment.invoice?.metadata && typeof payment.invoice.metadata === "object" && !Array.isArray(payment.invoice.metadata)) ? payment.invoice.metadata as Record<string, unknown> : {}),
            invoiceType: "wallet_topup",
            paymentPurpose: WALLET_TOPUP_PURPOSE,
            paymentId: payment.id,
            gateway: payment.gateway,
            gatewayOrderId: payment.gatewayOrderId || null,
            gatewayPaymentId: input.gatewayPaymentId || payment.gatewayPaymentId || null,
            gatewayTransactionId: transactionId,
            bankReferenceId: input.bankReferenceId || null,
            paidBy: actor,
          },
        },
      })
    }

    if (existing) {
      console.info("[WalletTopup][Finalize]", {
        paymentAttemptId: selectedAttempt.id,
        merchantOrderId,
        gatewayOrderId,
        customerId: payment.customerId,
        amount: paidAmount,
        currency: paidCurrency,
        oldBalance: Number(existing.balanceBefore || 0),
        newBalance: Number(existing.balanceAfter || 0),
        result: "already_credited",
      })
      return { finalized: true, reused: true, result: "already_credited", payment: updatedPayment, walletTransaction: existing }
    }

    const fee = await computeGatewayFee({ gateway: payment.gateway, grossAmount: paidAmount })
    const creditAmount = fee.netAmount

    const customerBefore = await tx.customer.findUnique({
      where: { id: payment.customerId },
      select: { walletBalance: true },
    })
    const oldBalance = Number(customerBefore?.walletBalance || 0)
    const walletTransaction = await createWalletTransaction(tx as DbClient, {
      customerId: payment.customerId,
      paymentId: payment.id,
      paymentAttemptId: selectedAttempt.id,
      type: "topup",
      amount: creditAmount,
      gateway: fee.gateway === "generic" ? payment.gateway : fee.gateway,
      gatewayFee: fee.feeAmount,
      reason: fee.feeAmount > 0 ? `Wallet top-up via ${payment.gateway} (${fee.feePercent}% + ₹${fee.fixedFee} fee applied)` : `Wallet top-up via ${payment.gateway}`,
      referenceId,
      note: transactionId ? `Gateway transaction: ${transactionId}` : "Wallet top-up payment confirmed",
      createdByType: "system",
      status: "completed",
    })

    const newBalance = Number(walletTransaction.balanceAfter || oldBalance)
    console.info("[WalletTopup][Finalize]", {
      paymentAttemptId: selectedAttempt.id,
      merchantOrderId,
      gatewayOrderId,
      customerId: payment.customerId,
      amount: paidAmount,
      feeAmount: fee.feeAmount,
      creditAmount,
      currency: paidCurrency,
      oldBalance,
      newBalance,
      result: wasFinalized ? "already_credited" : "credited",
    })
    return { finalized: true, reused: false, result: "credited", payment: updatedPayment, walletTransaction }
  }))
}

export async function markWalletTopupPaymentFailed(input: {
  paymentId: string
  message?: string | null
  status?: "failed" | "pending"
}) {
  const status = input.status || "failed"
  return prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({ where: { id: input.paymentId }, select: { id: true, invoiceId: true, checkoutSessionId: true, purpose: true } })
    if (!payment || !isWalletTopupPurpose(payment.purpose)) return { updated: false }
    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status,
        errorMessage: input.message || (status === "failed" ? "Payment failed at gateway" : null),
        webhookProcessedAt: status === "failed" ? new Date() : undefined,
      },
    })
    if (payment.invoiceId) {
      await tx.invoice.update({
        where: { id: payment.invoiceId },
        data: { status: status === "failed" ? "failed" : "pending" },
      }).catch(() => undefined)
    }
    if (payment.checkoutSessionId) {
      await tx.checkoutSession.update({ where: { id: payment.checkoutSessionId }, data: { status: "payment_failed" } }).catch(() => undefined)
    }
    return { updated: true }
  })
}
