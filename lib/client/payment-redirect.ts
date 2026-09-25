"use client"

export type PaymentRedirectResponse = {
  gateway?: string | null
  publicKey?: string | null
  public_key?: string | null
  key?: string | null
  keyId?: string | null
  key_id?: string | null
  gatewayOrderId?: string | null
  gateway_order_id?: string | null
  paymentUrl?: string | null
  payment_url?: string | null
  paymentLink?: string | null
  payment_link?: string | null
  checkoutUrl?: string | null
  checkout_url?: string | null
  redirectUrl?: string | null
  redirect_url?: string | null
  statusUrl?: string | null
  status_url?: string | null
  paymentSessionId?: string | null
  payment_session_id?: string | null
  order_id?: string | null
  razorpayOrderId?: string | null
  razorpay_order_id?: string | null
  bridgeUrl?: string | null
  bridge_url?: string | null
  embeddedAllowed?: boolean | null
  embedded_allowed?: boolean | null
  mode?: string | null
  checkoutOptions?: Record<string, any> | null
  checkout_options?: Record<string, any> | null
  brandName?: string | null
  brandImage?: string | null
  merchantName?: string | null
  razorpayFlow?: "order" | string | null
}

export type PaymentCheckoutTarget =
  | { kind: "razorpay-order"; orderId: string }
  | { kind: "bridge"; bridgeUrl: string; embeddedAllowed: boolean }
  | { kind: "payment-session"; paymentSessionId: string; mode: "production" | "sandbox"; fallbackUrl: string | null }
  | { kind: "url"; url: string }

let cashfreeSdkLoader: Promise<void> | null = null
let razorpaySdkLoader: Promise<void> | null = null
const CASHFREE_TIMEOUT_MS = 4000
const CHECKOUT_SESSION_ERROR = "Payment gateway did not return checkout session."

function loadCashfreeSdk(src: string): Promise<void> {
  if (cashfreeSdkLoader) return cashfreeSdkLoader
  cashfreeSdkLoader = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[data-cashfree-sdk="true"]`)
    if (existing && (window as any).Cashfree) {
      resolve()
      return
    }
    const script = document.createElement("script")
    script.src = src
    script.async = true
    script.dataset.cashfreeSdk = "true"
    script.onload = () => resolve()
    script.onerror = () => reject(new Error("Failed to load Cashfree checkout SDK"))
    document.head.appendChild(script)
  })
  return cashfreeSdkLoader
}

function loadRazorpaySdk(): Promise<void> {
  if (razorpaySdkLoader) return razorpaySdkLoader
  razorpaySdkLoader = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[data-razorpay-sdk="true"]`)
    if (existing && (window as any).Razorpay) {
      resolve()
      return
    }
    const script = document.createElement("script")
    script.src = "https://checkout.razorpay.com/v1/checkout.js"
    script.async = true
    script.dataset.razorpaySdk = "true"
    script.onload = () => resolve()
    script.onerror = () => reject(new Error("Failed to load Razorpay checkout SDK"))
    document.head.appendChild(script)
  })
  return razorpaySdkLoader
}

function firstString(...values: Array<unknown>) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return null
}

function isExternalUrl(value: string) {
  return /^https?:\/\//i.test(value)
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}

function directPaymentUrl(response: PaymentRedirectResponse) {
  return firstString(
    response.paymentUrl,
    response.payment_url,
    response.paymentLink,
    response.payment_link,
    response.checkoutUrl,
    response.checkout_url,
    response.redirectUrl,
    response.redirect_url,
  )
}

export function resolvePaymentCheckoutTarget(response: PaymentRedirectResponse): PaymentCheckoutTarget | null {
  const bridgeUrl = firstString(response.bridgeUrl, response.bridge_url)
  if ((response.mode === "bridge" || bridgeUrl) && bridgeUrl) {
    return {
      kind: "bridge",
      bridgeUrl,
      embeddedAllowed: response.embeddedAllowed ?? response.embedded_allowed ?? true,
    }
  }

  const gateway = String(response.gateway || "").toLowerCase()
  const checkoutOptions = (response.checkoutOptions || response.checkout_options || {}) as Record<string, any>
  const razorpayOrderId = firstString(
    response.razorpayOrderId,
    response.razorpay_order_id,
    response.order_id,
    response.gatewayOrderId,
    response.gateway_order_id,
    checkoutOptions.order_id,
    checkoutOptions.orderId,
  )
  if (gateway === "razorpay") {
    return razorpayOrderId?.startsWith("order_")
      ? { kind: "razorpay-order", orderId: razorpayOrderId }
      : null
  }

  const paymentSessionId = firstString(response.paymentSessionId, response.payment_session_id)
  const directUrl = directPaymentUrl(response)
  const mode = response.mode === "production" ? "production" : "sandbox"
  if (gateway === "cashfree" && paymentSessionId) {
    return { kind: "payment-session", paymentSessionId, mode, fallbackUrl: directUrl }
  }
  if (directUrl) return { kind: "url", url: directUrl }
  if (paymentSessionId) return { kind: "payment-session", paymentSessionId, mode, fallbackUrl: null }
  return null
}

function assignUrl(url: string, options: { push?: (url: string) => void } = {}) {
  if (isExternalUrl(url)) {
    window.location.href = url
    return
  }
  if (options.push) {
    options.push(url)
    return
  }
  window.location.href = url
}

async function startCashfreeCheckout(paymentSessionId: string, mode: "production" | "sandbox") {
  const sdkUrl = mode === "production" ? "https://sdk.cashfree.com/js/v3/cashfree.js" : "https://sdk.cashfree.com/js/v3/cashfree-sandbox.js"
  console.info("[Checkout][Payment] loading Cashfree SDK", { mode })
  try {
    await withTimeout(loadCashfreeSdk(sdkUrl), CASHFREE_TIMEOUT_MS, "Cashfree checkout SDK load timed out.")
  } catch (error) {
    cashfreeSdkLoader = null
    console.error("[Checkout][Payment] Cashfree SDK load failed", error)
    throw error
  }

  const cashfreeFactory = (window as any)?.Cashfree
  if (typeof cashfreeFactory !== "function") throw new Error("Cashfree checkout SDK failed to initialize")
  console.info("[Checkout][Payment] starting Cashfree checkout", { mode, hasPaymentSessionId: Boolean(paymentSessionId) })
  await withTimeout(
    Promise.resolve(cashfreeFactory({ mode }).checkout({ paymentSessionId, redirectTarget: "_self" })),
    CASHFREE_TIMEOUT_MS,
    "Cashfree checkout did not open in time.",
  )
}

async function startRazorpayStandardCheckout(response: PaymentRedirectResponse, orderId: string) {
  await withTimeout(loadRazorpaySdk(), CASHFREE_TIMEOUT_MS, "Razorpay checkout SDK load timed out.")
  const Razorpay = (window as any)?.Razorpay
  if (typeof Razorpay !== "function") throw new Error("Razorpay checkout SDK failed to initialize")
  const checkoutOptions = (response.checkoutOptions || response.checkout_options || {}) as Record<string, any>
  const key = await resolveRazorpayPublicKey(response)
  if (!key) throw new Error("Razorpay public key is not configured by the backend runtime gateway service.")
  const checkoutOrderId = firstString(checkoutOptions.order_id, checkoutOptions.orderId, orderId)
  if (!checkoutOrderId) throw new Error("Razorpay order ID is missing from checkout response.")
  const amount = Number(checkoutOptions.amount)
  const currency = firstString(checkoutOptions.currency, (response as any).currency)
  const name = firstString(checkoutOptions.name, response.brandName, response.merchantName)
  const description = firstString(checkoutOptions.description)
  if (!checkoutOrderId.startsWith("order_")) throw new Error("Razorpay order ID is invalid.")
  if (!Number.isInteger(amount) || amount <= 0) throw new Error("Razorpay amount is invalid.")
  if (!currency) throw new Error("Razorpay currency is missing.")
  if (!name || !description) throw new Error("Razorpay checkout branding is incomplete.")
  if (!checkoutOptions.prefill || typeof checkoutOptions.prefill !== "object") throw new Error("Razorpay customer prefill is missing.")
  if (!checkoutOptions.notes || typeof checkoutOptions.notes !== "object") throw new Error("Razorpay order notes are missing.")
  await new Promise<void>((resolve, reject) => {
    const checkout = new Razorpay({
      ...checkoutOptions,
      key,
      order_id: checkoutOrderId,
      handler: async (payload: any) => {
        try {
          const verify = await fetch("/api/payments/razorpay/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              paymentId: (response as any).paymentId || null,
              razorpay_payment_id: payload?.razorpay_payment_id,
              razorpay_order_id: payload?.razorpay_order_id || checkoutOrderId,
              razorpay_signature: payload?.razorpay_signature,
            }),
          })
          if (!verify.ok) throw new Error("Razorpay verification failed.")
          resolve()
          const statusUrl = firstString(response.statusUrl, response.status_url) || "/client-area/billing"
          window.location.href = statusUrl
        } catch (error) {
          reject(error)
        }
      },
      modal: {
        ...(checkoutOptions.modal || {}),
        ondismiss: () => reject(new Error("Razorpay checkout was closed.")),
      },
    })
    try {
      checkout.open()
    } catch (error) {
      reject(error)
    }
  })
}

async function resolveRazorpayPublicKey(response: PaymentRedirectResponse) {
  const direct = firstString(response.publicKey, response.public_key, response.key, response.keyId, response.key_id)
  if (direct) return direct
  try {
    const runtimeResponse = await fetch("/api/payments/runtime", { cache: "no-store" })
    const data = await runtimeResponse.json().catch(() => ({}))
    const gateways = Array.isArray(data?.enabledGateways) ? data.enabledGateways : Array.isArray(data?.gateways) ? data.gateways : []
    const razorpay = gateways.find((gateway: any) => String(gateway?.gateway || "").toLowerCase() === "razorpay")
    return firstString(razorpay?.publicKey, razorpay?.public_key, razorpay?.keyId, razorpay?.key_id)
  } catch (error) {
    console.error("[Checkout][Payment] Razorpay public runtime config lookup failed", error)
    return null
  }
}

export async function startPaymentRedirect(
  response: PaymentRedirectResponse,
  options: { push?: (url: string) => void; expectedGateway?: string | null } = {},
) {
  const gateway = String(response.gateway || "").toLowerCase()
  const expectedGateway = options.expectedGateway ? String(options.expectedGateway).toLowerCase() : null
  if (expectedGateway && gateway && gateway !== expectedGateway) {
    console.error("[Checkout][Payment] PAYMENT_GATEWAY_MISMATCH", {
      selectedGateway: expectedGateway,
      requestedGateway: expectedGateway,
      returnedGateway: gateway,
      orderId: response.order_id || response.gatewayOrderId || response.gateway_order_id || null,
      checkoutSessionId: (response as any).checkoutSessionId || null,
      timestamp: new Date().toISOString(),
    })
    throw new Error(CHECKOUT_SESSION_ERROR)
  }

  const target = resolvePaymentCheckoutTarget(response)
  if (target?.kind === "bridge") {
    window.dispatchEvent(new CustomEvent("zws:payment-bridge", { detail: { bridgeUrl: target.bridgeUrl, embeddedAllowed: target.embeddedAllowed } }))
    return
  }
  if (target?.kind === "razorpay-order") {
    await startRazorpayStandardCheckout(response, target.orderId)
    return
  }
  if (target?.kind === "payment-session") {
    try {
      await startCashfreeCheckout(target.paymentSessionId, target.mode)
    } catch (error) {
      console.error("[Checkout][Payment] Cashfree checkout failed", error)
      if (target.fallbackUrl) {
        console.info("[Checkout][Payment] falling back to payment URL", { gateway, hasDirectUrl: true })
        assignUrl(target.fallbackUrl, options)
        return
      }
      throw new Error(CHECKOUT_SESSION_ERROR)
    }
    return
  }

  if (target?.kind === "url") {
    console.info("[Checkout][Payment] redirecting to payment URL", { gateway: gateway || null, hasDirectUrl: true })
    assignUrl(target.url, options)
    return
  }

  const statusUrl = firstString(response.statusUrl, response.status_url)
  if (statusUrl) {
    if (options.push && !isExternalUrl(statusUrl)) {
      options.push(statusUrl)
      return
    }
    window.location.href = statusUrl
    return
  }

  throw new Error(CHECKOUT_SESSION_ERROR)
}
