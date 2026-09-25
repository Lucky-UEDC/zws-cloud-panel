"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Image from "next/image"
import type React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  ArrowLeft,
  ArrowRight,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Clock,
  Cpu,
  Database,
  Globe2,
  HardDrive,
  Eye,
  EyeOff,
  KeyRound,
  Copy,
  Minus,
  Plus,
} from "lucide-react"
import { toast } from "sonner"
import { Container } from "@/components/layout/container"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { formatBandwidthQuota } from "@/lib/bandwidth-format"
import { validateReturnedGateway, gatewayDisplayName } from "@/lib/payments/gateway-selection"
import { Spinner } from "@/components/ui/spinner"
import { PhonePeBridgeModal } from "@/components/payments/PhonePeBridgeModal"
import { trackGaEvent } from "@/components/analytics/analytics-provider"
import { GoogleOAuthButton } from "@/components/auth/google-oauth-button"
import { TurnstileWidget, useTurnstileConfig } from "@/components/security/turnstile-widget"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { BILLING_TERMS, formatPrice, getTermLabel, monthlyToHourly, type BillingTerm } from "@/lib/pricing"
import { formatCloudInstanceSpecs, getCloudInstanceName } from "@/lib/cloud-instance-names"
import { readJsonResponse } from "@/lib/client/safe-json"
import { paymentClientMessage } from "@/lib/client/payment-errors"
import { resolvePaymentCheckoutTarget, startPaymentRedirect } from "@/lib/client/payment-redirect"
import type { CheckoutApiSuccess, CheckoutQuote, CheckoutQuoteResult } from "@/lib/checkout-shared"
import { hasCompleteBillingAddress } from "@/lib/checkout-identity"
import { getResolvedOsIcon, handleOsIconError } from "@/lib/os-icons"
import { BULK_DISCOUNT_PERCENT, customerHostnameSlug, generateVmHostnames, hasBulkDiscount, planHostnameSlug } from "@/lib/order-bulk"
import { clearCheckoutResumeIntent, readCheckoutResumeIntent, writeCheckoutResumeIntent } from "@/lib/client/checkout-resume"

export type Product = {
  id: string
  slug: string
  name: string
  type: string
  cpuCores: number
  ramGb: number
  storageGb: number
  storageType?: string
  bandwidthTb?: number
  regions?: Array<{ slug?: string; name?: string; supportedTemplates?: string[]; supportedTemplateIds?: string[] } | string>
  specs?: Record<string, any>
  optionGroups?: unknown[] | null
  price1m: number
  price3m?: number | null
  price6m?: number | null
  price12m?: number | null
  price24m?: number | null
  price36m?: number | null
  billingTerms?: number[]
  pricing?: { termPrice: number; term: number; termTotal: number; quote?: LegacyQuote }
  calculatedMonthlyPrice?: number | null
  productMonthlyPrice?: number | null
  fixedDiscountAmount?: number | null
  fixedDiscountPercent?: number | null
  showFixedDiscount?: boolean
  pricingBreakdown?: {
    cpuPrice: number
    ramPrice: number
    storagePrice: number
    bandwidthPrice: number
    osPrice: number
    regionPrice: number
  } | null
  backupEnabled?: boolean
  backupPrice?: number
  backupStorageGb?: number
  snapshotEnabled?: boolean
  snapshotPrice?: number
  snapshotIncludedCount?: number
  bandwidthEnabled?: boolean
  bandwidthPrice?: number
  bandwidthLimitTb?: number | null
  bandwidthOveragePrice?: number
  extraIpv4Price?: number
}

export type OperatingSystem = {
  id: string
  name: string
  slug: string
  osType: string
  category: string
  proxmoxVmid: number
  proxmoxNodeId: string
  family?: string
  familyLabel?: string
  familyDescription?: string
  version?: string
  defaultUsername?: string
  recommended?: boolean
  eolWarningText?: string | null
  iconUrl?: string | null
  proxmoxTemplateName?: string | null
}

type AccessMethod = "PASSWORD" | "PASSWORD_AND_SSH_KEY" | "SAVED_SSH_KEY" | "GENERATED_SSH_KEY" | "PASTED_SSH_KEY"
type PaymentMethod = "gateway"
export type CheckoutGatewayCode = "razorpay" | "phonepe" | "cashfree"
type PaymentState = "idle" | "initializing" | "redirecting" | "waiting" | "verifying" | "verified" | "error"

export type CheckoutGatewayOption = {
  code: CheckoutGatewayCode
  label: string
  logo?: string | null
}

type BillingAddressDraft = {
  addressLine1: string
  addressLine2: string
  city: string
  state: string
  country: string
  postalCode: string
}

export type CheckoutDraft = {
  productId: string
  productSlug: string
  productType: string
  termMonths: BillingTerm
  region: string
  osTemplateId: string
  osFamily: string
  osVersion: string
  accessMethod: AccessMethod
  hostname: string
  quantity: number
  adminUser: string
  password: string
  sshKeyMode: AccessMethod
  savedSshKeyId: string | null
  generatedSshKeyId: string | null
  pastedSshKey: string
  savePastedSshKey: boolean
  couponCode: string
  customCpu: number
  customRamGb: number
  customStorageGb: number
  customBandwidthTb: number
  backupEnabled: boolean
  snapshotCount: number
  ipv4Count: number
  nodeId: string
  diskTier: string
  storagePoolId: string
  cpuTier: string
  generatedPrivateKey: string | null
  privateKeyConfirmed: boolean
  saveSshKey: boolean
  sshKeyLabel: string
  billingAddress: BillingAddressDraft
  paymentMethod: PaymentMethod
}

type LegacyQuote = {
  term: BillingTerm
  months: number
  discountPercent: number
  explicitTermPrice: boolean
  baseMonthlyPrice: number
  selectedMonthlyPrice: number
  effectiveMonthlyPrice: number
  baseSubtotal: number
  termSubtotal: number
  termDiscount: number
  couponDiscount: number
  taxable: number
  taxAmount: number
  payableToday: number
  renewalDate: string
}

type Quote = CheckoutQuote

export const INITIAL_CHECKOUT_DRAFT: CheckoutDraft = {
  productId: "",
  productSlug: "",
  productType: "",
  termMonths: 1,
  region: "India",
  osTemplateId: "",
  osFamily: "",
  osVersion: "",
  accessMethod: "PASSWORD",
  hostname: "",
  quantity: 1,
  adminUser: "root",
  password: "",
  sshKeyMode: "PASSWORD",
  savedSshKeyId: null,
  generatedSshKeyId: null,
  pastedSshKey: "",
  savePastedSshKey: false,
  couponCode: "",
  customCpu: 2,
  customRamGb: 4,
  customStorageGb: 80,
  customBandwidthTb: 2,
  backupEnabled: false,
  snapshotCount: 0,
  ipv4Count: 1,
  nodeId: "",
  diskTier: "nvme",
  storagePoolId: "",
  cpuTier: "standard",
  generatedPrivateKey: null,
  privateKeyConfirmed: false,
  saveSshKey: false,
  sshKeyLabel: "",
  billingAddress: {
    addressLine1: "",
    addressLine2: "",
    city: "",
    state: "",
    country: "India",
    postalCode: "",
  },
  paymentMethod: "gateway",
}

export type CheckoutBootstrap = {
  product: Product | null
  operatingSystems: OperatingSystem[]
  savedKeys: any[]
  initialDraft: CheckoutDraft
  initialQuote: Quote | null
  initialBillingDiscounts: Record<number, number>
  availableGateways: CheckoutGatewayOption[]
  defaultGateway: CheckoutGatewayCode | null
  bootstrapError?: {
    code: string
    message: string
    productSlug?: string | null
    productId?: string | null
    nodeId?: string | null
    templateId?: string | null
  } | null
}

function firstRegion(product: Product | null | undefined) {
  const first = product?.regions?.[0]
  if (!first) return "India"
  return typeof first === "string" ? first : (first.name || first.slug || "India")
}

const PAYMENT_START_TIMEOUT_MS = 10000
const PAYMENT_SESSION_ERROR = "Unable to initialize payment session. Unable to open payment gateway. Try again."

function firstPaymentString(...values: Array<unknown>) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return null
}

function validatePaymentStartResponse(data: any) {
  if (!data || data.success !== true) {
    throw new Error(data?.error || data?.message || "Payment could not be started.")
  }
  if (!data.gateway) throw new Error("Payment gateway was not returned.")
  if (!data.orderId && !data.checkoutSessionId && !data.checkoutIntentId) throw new Error("Payment session was not returned.")
  if (!data.invoiceId && !data.checkoutSessionId && !data.checkoutIntentId) throw new Error("Payment invoice was not returned.")
  if (String(data.gateway).toLowerCase() !== "wallet" && !resolvePaymentCheckoutTarget(data)) {
    throw new Error(PAYMENT_SESSION_ERROR)
  }
}

function isPricingRefreshCode(code: unknown) {
  return String(code || "").toLowerCase().startsWith("price_token")
    || String(code || "").toLowerCase().startsWith("pricing_token")
}

function checkoutIdempotencyKey() {
  const random = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `checkout-${random}`
}

const CHECKOUT_IDEMPOTENCY_STORAGE_KEY = "zws:checkout:idempotency-key"

function storedCheckoutIdempotencyKey() {
  try {
    return globalThis.sessionStorage?.getItem(CHECKOUT_IDEMPOTENCY_STORAGE_KEY) || null
  } catch {
    return null
  }
}

function storeCheckoutIdempotencyKey(value: string | null) {
  try {
    if (value) globalThis.sessionStorage?.setItem(CHECKOUT_IDEMPOTENCY_STORAGE_KEY, value)
    else globalThis.sessionStorage?.removeItem(CHECKOUT_IDEMPOTENCY_STORAGE_KEY)
  } catch {
    // Session storage is best-effort only.
  }
}

function validCheckoutHostname(value: string) {
  const normalized = String(value || "").trim()
  if (!normalized || normalized.length > 253) return false
  return normalized.split(".").every((label) => (
    label.length > 0 &&
    label.length <= 63 &&
    /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(label)
  ))
}

export function CheckoutContent({ bootstrap, brandName = "Cloud", siteUrl = "", currency = "INR" }: { bootstrap: CheckoutBootstrap; brandName?: string; siteUrl?: string; currency?: string }) {
  const router = useRouter()
  const product = bootstrap.product
  const operatingSystems = useMemo(() => Array.isArray(bootstrap.operatingSystems) ? bootstrap.operatingSystems : [], [bootstrap.operatingSystems])
  const [serverQuote, setServerQuote] = useState<Quote | null>(() => bootstrap.initialQuote)
  const [billingDiscounts, setBillingDiscounts] = useState<Record<number, number>>(() => bootstrap.initialBillingDiscounts)
  const [quoteLoading, setQuoteLoading] = useState(false)
  const [quoteError, setQuoteError] = useState<string | null>(null)
  const [paymentState, setPaymentState] = useState<PaymentState>("idle")
  const [checkoutError, setCheckoutError] = useState<string | null>(null)
  const [couponApplying, setCouponApplying] = useState(false)
  const [couponDiscount, setCouponDiscount] = useState(0)
  const [couponValidCode, setCouponValidCode] = useState<string | null>(null)
  const [couponError, setCouponError] = useState<string | null>(null)
  const [showBreakdown, setShowBreakdown] = useState(false)
  const [phonePeBridgeUrl, setPhonePeBridgeUrl] = useState<string | null>(null)
  const [authModalOpen, setAuthModalOpen] = useState(false)
  const [resumeChecked, setResumeChecked] = useState(false)
  const [checkoutDraft, setCheckoutDraft] = useState<CheckoutDraft>(() => bootstrap.initialDraft)
  const availableGateways = useMemo(() => Array.isArray(bootstrap.availableGateways) ? bootstrap.availableGateways : [], [bootstrap.availableGateways])
  const [selectedGateway, setSelectedGateway] = useState<CheckoutGatewayCode | null>(() => bootstrap.defaultGateway)
  const [clientDisplayName, setClientDisplayName] = useState("")
  const [copiedSecret, setCopiedSecret] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const [profileLoading, setProfileLoading] = useState(false)
  const [turnstileToken, setTurnstileToken] = useState("")
  const turnstile = useTurnstileConfig()
  const captchaRequired = turnstile.enabled && turnstile.protect.checkout
  const [hasBillingAddress, setHasBillingAddress] = useState<boolean | null>(null)
  const [savedBillingAddress, setSavedBillingAddress] = useState<{
    line1: string
    city: string
    state: string
    country: string
    postalCode: string
  } | null>(null)
  const [missingBillingFields, setMissingBillingFields] = useState<string[]>([])
  const checkoutDraftRef = useRef<CheckoutDraft>(bootstrap.initialDraft)
  const checkoutSubmitRef = useRef(false)
  const checkoutIdempotencyRef = useRef<string | null>(null)

  const handleGatewayChange = useCallback((code: CheckoutGatewayCode) => {
    setSelectedGateway(code)
    // A checkout session/order belongs to exactly ONE gateway: when the customer
    // switches gateways, rotate the idempotency key so a session created for the
    // previous gateway can never be reused, and clear gateway-specific state.
    checkoutIdempotencyRef.current = null
    storeCheckoutIdempotencyKey(null)
    setCheckoutError(null)
    if (paymentState === "error") setPaymentState("idle")
  }, [paymentState])
  const focusedFieldRef = useRef<string | null>(null)
  const quoteRequestRef = useRef(0)
  const submitting = paymentState === "initializing" || paymentState === "redirecting" || paymentState === "waiting" || paymentState === "verifying"

  const currentCheckoutUrl = useCallback(() => {
    if (typeof window === "undefined") return "/checkout"
    return `${window.location.pathname}${window.location.search || ""}`
  }, [])

  const checkoutResumeDraft = useCallback((paymentRequested: boolean) => {
    const current = checkoutDraftRef.current
    return {
      product: current.productSlug || current.productId || product?.slug || product?.id || null,
      term: current.termMonths,
      hostname: current.hostname,
      os: current.osTemplateId,
      quantity: current.quantity,
      coupon: current.couponCode || couponValidCode || "",
      configuration: {
        productId: current.productId || product?.id || null,
        productSlug: current.productSlug || product?.slug || null,
        region: current.region,
        customCpu: current.customCpu,
        customRamGb: current.customRamGb,
        customStorageGb: current.customStorageGb,
        customBandwidthTb: current.customBandwidthTb,
        nodeId: current.nodeId,
        diskTier: current.diskTier,
        storagePoolId: current.storagePoolId,
        cpuTier: current.cpuTier,
        accessMethod: current.accessMethod,
        adminUser: current.adminUser,
        sshKeyMode: current.sshKeyMode,
      },
      paymentRequested,
    }
  }, [couponValidCode, product?.id, product?.slug])

  const promptForAuth = useCallback((paymentRequested: boolean) => {
    writeCheckoutResumeIntent({
      url: currentCheckoutUrl(),
      paymentRequested,
      draft: checkoutResumeDraft(paymentRequested),
    })
    setPaymentState("idle")
    setCheckoutError(null)
    setAuthModalOpen(true)
  }, [checkoutResumeDraft, currentCheckoutUrl])

  useEffect(() => {
    function onBridge(event: Event) {
      const detail = (event as CustomEvent<{ bridgeUrl?: string }>).detail
      if (detail?.bridgeUrl) setPhonePeBridgeUrl(detail.bridgeUrl)
    }
    window.addEventListener("zws:payment-bridge", onBridge)
    return () => window.removeEventListener("zws:payment-bridge", onBridge)
  }, [])

  useEffect(() => {
    let cancelled = false
    async function loadProfile() {
      setProfileLoading(true)
      try {
        const res = await fetch("/api/client/profile", { cache: "no-store" })
        if (!res.ok) return
        const data = await readJsonResponse<any>(res)
        if (cancelled || !data?.profile) return
        const address = data.profile.address || {}
        setClientDisplayName(String(data.profile.name || data.profile.email || ""))
        const normalizedAddress = {
          addressLine1: address.addressLine1 || address.line1,
          city: address.city,
          state: address.state,
          country: address.country,
          postalCode: address.postalCode,
          phone: data.profile.phone,
        }
        const complete = hasCompleteBillingAddress(normalizedAddress)
        const missing = [
          ...(normalizedAddress.addressLine1 ? [] : ["addressLine1"]),
          ...(normalizedAddress.city ? [] : ["city"]),
          ...(normalizedAddress.state ? [] : ["state"]),
          ...(normalizedAddress.country ? [] : ["country"]),
          ...(normalizedAddress.postalCode ? [] : ["postalCode"]),
          ...(normalizedAddress.phone ? [] : ["phone"]),
        ]
        setHasBillingAddress(complete)
        setMissingBillingFields(complete ? [] : missing)
        setSavedBillingAddress(complete ? {
          line1: String(normalizedAddress.addressLine1 || ""),
          city: String(normalizedAddress.city || ""),
          state: String(normalizedAddress.state || ""),
          country: String(normalizedAddress.country || ""),
          postalCode: String(normalizedAddress.postalCode || ""),
        } : null)
      } finally {
        if (!cancelled) setProfileLoading(false)
      }
    }
    void loadProfile()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (resumeChecked || !clientDisplayName || profileLoading) return
    const intent = readCheckoutResumeIntent()
    setResumeChecked(true)
    if (!intent?.paymentRequested) return
    const target = currentCheckoutUrl()
    if (intent.url !== target) return
    clearCheckoutResumeIntent()
    window.setTimeout(() => {
      document.querySelector<HTMLFormElement>("[data-cloud-checkout-form]")?.requestSubmit()
    }, 250)
  }, [clientDisplayName, currentCheckoutUrl, profileLoading, resumeChecked])

  const updateDraft = useCallback((next: CheckoutDraft) => {
    checkoutDraftRef.current = next
    setCheckoutDraft(next)
  }, [])

  const markDraftChange = useCallback(<K extends keyof CheckoutDraft>(field: K, value: CheckoutDraft[K]) => {
    updateDraft({ ...checkoutDraftRef.current, [field]: value })
  }, [updateDraft])

  function markDraftInputChange<K extends keyof CheckoutDraft>(field: K, value: CheckoutDraft[K]) {
    updateDraft({ ...checkoutDraftRef.current, [field]: value })
  }

  function markDraftNumericChange<K extends keyof CheckoutDraft>(field: K, value: CheckoutDraft[K]) {
    if (field !== "snapshotCount" && field !== "ipv4Count") {
      markDraftInputChange(field, value)
      return
    }
    const parsed = Math.max(field === "ipv4Count" ? 1 : 0, Math.floor(Number(value || 0)))
    updateDraft({ ...checkoutDraftRef.current, [field]: parsed } as CheckoutDraft)
  }

  function generateCheckoutPassword() {
    const groups = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnopqrstuvwxyz", "23456789", "!@#$%^&*"]
    const charset = groups.join("")
    const bytes = new Uint8Array(18)
    globalThis.crypto?.getRandomValues(bytes)
    const required = groups.map((group, index) => group[bytes[index] % group.length])
    const rest = Array.from(bytes.slice(required.length), (byte) => charset[byte % charset.length])
  const password = [...required, ...rest].sort(() => Math.random() - 0.5).join("")
  markDraftInputChange("password", password)
  toast.success("Password generated")
  }

  async function copyCheckoutSecret(value: string, key: string, label = "Copied") {
    await navigator.clipboard.writeText(value)
    setCopiedSecret(key)
    toast.success(label)
    window.setTimeout(() => setCopiedSecret((current) => current === key ? null : current), 1200)
  }

  function focusDraftField(field: string) {
    focusedFieldRef.current = field
  }

  function blurDraftField(field: string) {
    if (focusedFieldRef.current === field) focusedFieldRef.current = null
  }

  const {
    termMonths: selectedTerm,
    osTemplateId: operatingSystemId,
    osFamily: selectedOsFamily,
  } = checkoutDraft

  const refreshCheckoutQuote = useCallback(async (options: { signal?: AbortSignal; quiet?: boolean } = {}) => {
    if (!product?.id) throw new Error("Selected cloud instance is unavailable.")
    const requestId = quoteRequestRef.current + 1
    quoteRequestRef.current = requestId
    if (!options.quiet) {
      setQuoteLoading(true)
      setQuoteError(null)
    }
    try {
      const draft = checkoutDraftRef.current
      const res = await fetch("/api/checkout/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: options.signal,
        body: JSON.stringify({
          draft,
          productId: draft.productId || product.id,
          productSlug: draft.productSlug || product.slug,
          productType: draft.productType || product.type,
          term: draft.termMonths,
          region: draft.region,
          osTemplateId: draft.osTemplateId,
          customCpu: draft.customCpu,
          customRamGb: draft.customRamGb,
          customStorageGb: draft.customStorageGb,
          customBandwidthTb: draft.customBandwidthTb,
          diskTier: draft.diskTier,
          storagePoolId: draft.storagePoolId,
          cpuTier: draft.cpuTier,
          nodeId: draft.nodeId,
          couponCode: couponValidCode,
          couponDiscount,
        }),
      })
      const data = await readJsonResponse<CheckoutApiSuccess<CheckoutQuoteResult> | { ok: false; error?: string }>(res)
      if (!data) throw new Error("Quote failed")
      if (!res.ok || !data.ok) {
        const errorData = data as { ok: false; error?: string }
        throw new Error(errorData.error || "Quote failed")
      }
      if (quoteRequestRef.current !== requestId) return null
      setServerQuote(data.data.quote)
      if (data.data.billingDiscounts) setBillingDiscounts(data.data.billingDiscounts)
      return data.data.quote
    } finally {
      if (!options.quiet && quoteRequestRef.current === requestId) setQuoteLoading(false)
    }
  }, [couponDiscount, couponValidCode, product?.id, product?.slug, product?.type])

  useEffect(() => {
    if (!product?.id) return
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      try {
        if (process.env.NODE_ENV !== "production") {
          console.debug("[CheckoutContent] quote request start", { productId: product.id, term: checkoutDraftRef.current.termMonths })
        }
        await refreshCheckoutQuote({ signal: controller.signal })
        if (process.env.NODE_ENV !== "production") console.debug("[CheckoutContent] quote request success")
      } catch (error: any) {
        if (error?.name === "AbortError") {
          if (process.env.NODE_ENV !== "production") console.debug("[CheckoutContent] quote request aborted")
          return
        }
        setQuoteError(error?.message || "Unable to update price. Your selections are preserved.")
        console.warn("[Checkout] quote refresh failed", error?.message || error)
      }
    }, 450)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [
    product?.id,
    product?.slug,
    product?.type,
    selectedTerm,
    checkoutDraft.region,
    checkoutDraft.osTemplateId,
    checkoutDraft.customCpu,
    checkoutDraft.customRamGb,
    checkoutDraft.customStorageGb,
    checkoutDraft.customBandwidthTb,
    checkoutDraft.diskTier,
    checkoutDraft.storagePoolId,
    checkoutDraft.cpuTier,
    checkoutDraft.nodeId,
    hasBillingAddress,
    profileLoading,
    refreshCheckoutQuote,
  ])

  const allowedTerms = useMemo(() => {
    const terms = Array.isArray(product?.billingTerms) ? product.billingTerms.map(Number) : BILLING_TERMS
    const filtered = BILLING_TERMS.filter((item) => terms.includes(item))
    return filtered.length ? filtered : BILLING_TERMS
  }, [product])

  const defaultRegion = useMemo(() => {
    return firstRegion(product)
  }, [product])
  const isCustomCheckout = product?.type === "configurable"
  const displayCpu = isCustomCheckout ? checkoutDraft.customCpu : Number(product?.cpuCores || 0)
  const displayRam = isCustomCheckout ? checkoutDraft.customRamGb : Number(product?.ramGb || 0)
  const displayStorage = isCustomCheckout ? checkoutDraft.customStorageGb : Number(product?.storageGb || 0)
  const displayBandwidth = isCustomCheckout ? checkoutDraft.customBandwidthTb : Number(product?.bandwidthTb || 0)
  const displayBandwidthLabel = formatBandwidthQuota(displayBandwidth, { suffix: "included" })
  const addOnMonthly = Number((
    (checkoutDraft.backupEnabled && product?.backupEnabled ? Number(product.backupPrice || 0) : 0) +
    (Math.max(0, Number(checkoutDraft.snapshotCount || 0) - Number(product?.snapshotIncludedCount || 0)) * Number(product?.snapshotPrice || 0)) +
    (Math.max(0, Number(checkoutDraft.ipv4Count || 1) - 1) * Number(product?.extraIpv4Price || 0))
  ).toFixed(2))

  const selectedOs = useMemo(() => operatingSystems.find((os) => os.id === operatingSystemId) || null, [operatingSystems, operatingSystemId])
  const regionTemplateIds = useMemo(() => supportedTemplateIdsForRegion(product, checkoutDraft.region || defaultRegion), [checkoutDraft.region, defaultRegion, product])
  const templateCompatible = useCallback((os: OperatingSystem | null | undefined) => {
    if (!os || !regionTemplateIds) return true
    return regionTemplateIds.has(os.id)
  }, [regionTemplateIds])
  const selectedTemplateIncompatible = Boolean(selectedOs && !templateCompatible(selectedOs))
  useEffect(() => {
    if (!operatingSystems.length || selectedOs) return
    const fallback = operatingSystems.find((os) => os.recommended) || operatingSystems[0]
    if (!fallback) return
    updateDraft({
      ...checkoutDraftRef.current,
      osTemplateId: fallback.id,
      osFamily: fallback.family || "",
      osVersion: fallback.version || fallback.name || "",
      adminUser: fallback.defaultUsername || checkoutDraftRef.current.adminUser || "root",
    })
  }, [operatingSystems, selectedOs, updateDraft])
  useEffect(() => {
    if (!regionTemplateIds || !selectedTemplateIncompatible) return
    const fallback = operatingSystems.find((os) => templateCompatible(os) && os.recommended) || operatingSystems.find((os) => templateCompatible(os))
    updateDraft({
      ...checkoutDraftRef.current,
      osTemplateId: fallback?.id || "",
      osFamily: fallback?.family || "",
      osVersion: fallback?.version || fallback?.name || "",
      adminUser: fallback?.defaultUsername || checkoutDraftRef.current.adminUser || "root",
    })
  }, [operatingSystems, regionTemplateIds, selectedTemplateIncompatible, templateCompatible, updateDraft])
  const osFamilies = useMemo(() => {
    const groups = new Map<string, { family: string; label: string; description: string; iconUrl?: string | null; items: OperatingSystem[] }>()
    for (const os of operatingSystems) {
      const family = os.family || "custom"
      const current = groups.get(family) || {
        family,
        label: os.familyLabel || "Custom",
        description: os.familyDescription || "Custom operating system",
        iconUrl: os.iconUrl,
        items: [],
      }
      if (!current.iconUrl && os.iconUrl) current.iconUrl = os.iconUrl
      current.items.push(os)
      groups.set(family, current)
    }
    return Array.from(groups.values()).sort((a, b) => a.label.localeCompare(b.label))
  }, [operatingSystems])
  const familyVersions = useMemo(() => osFamilies.find((family) => family.family === (selectedOsFamily || selectedOs?.family))?.items || [], [osFamilies, selectedOsFamily, selectedOs?.family])

  const instanceName = getCloudInstanceName(product || { slug: checkoutDraft.productSlug || "Cloud Instance" })
  const checkoutTitle = !product ? "Cloud Instance Unavailable" : `Deploy ${instanceName} Cloud Instance`
  const instanceSpecs = product ? formatCloudInstanceSpecs(product) : ""
  const quote = serverQuote
  const displayCurrency = "INR"
  const checkoutCountry = String(quote?.localized?.countryCode || quote?.regional?.countryCode || "IN").toUpperCase()
  const isIndiaCheckout = checkoutCountry === "IN"
  const monthlyTotal = quote?.monthly.total ?? Number(product?.pricing?.termPrice || product?.price1m || 0)
  const monthlyBase = quote?.monthly.base ?? Number(product?.price1m || 0)
  const quantity = Math.max(1, Math.min(100, Math.floor(Number(checkoutDraft.quantity || 1))))
  const singlePayAmount = quote?.term.subtotal ?? Number((monthlyTotal * selectedTerm).toFixed(2))
  const payAmount = Number((singlePayAmount * quantity).toFixed(2))
  const termDiscount = Number((Number(quote?.term.discountAmount ?? 0) * quantity).toFixed(2))
  const quoteCouponDiscount = quote?.coupon.discountAmount ?? couponDiscount
  const scaledCouponDiscount = Number((Number(quoteCouponDiscount || 0) * quantity).toFixed(2))
  const bulkDiscountApplied = hasBulkDiscount(quantity)
  const bulkDiscountAmount = bulkDiscountApplied ? Number((payAmount * (BULK_DISCOUNT_PERCENT / 100)).toFixed(2)) : 0
  const taxableAmount = Math.max(0, Number((payAmount - scaledCouponDiscount - bulkDiscountAmount).toFixed(2)))
  const taxAmount = Number((taxableAmount * Number(quote?.tax.percent ?? 18) / 100).toFixed(2))
  const payableToday = Number((taxableAmount + taxAmount).toFixed(2))
  const effectiveMonthly = quote?.effectiveMonthly ?? Number((payableToday / selectedTerm).toFixed(2))
  const hourlyPrice = monthlyToHourly(monthlyTotal)
  const renewalDate = quote?.renewalDate ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(new Date(quote.renewalDate)) : "-"
  const renewalAmount = Math.max(0, Number((payAmount + taxAmount - scaledCouponDiscount - bulkDiscountAmount).toFixed(2)))
  const selectedAdminUser = selectedOs?.defaultUsername || checkoutDraft.adminUser || "root"
  const osSummary = selectedOs ? `${selectedOs.familyLabel || selectedOs.name} ${selectedOs.version || ""}`.trim() : "Select OS"
  const hostnamePlan = planHostnameSlug(instanceName || checkoutDraft.productSlug || "plan")
  const hostnameClient = customerHostnameSlug(clientDisplayName || "user")
  const generatedHostnames = generateVmHostnames({ planName: hostnamePlan, customerName: hostnameClient, quantity })
  const accessPreviewPassword = checkoutDraft.password ? "********" : "Not set"
  const passwordRequirements = useMemo(() => passwordRequirementRows(checkoutDraft.password), [checkoutDraft.password])
  const passwordStrongEnough = passwordStrengthScore(checkoutDraft.password) >= 3
  const discountPercent = Number(quote?.term.discountPercent || 0)
  const couponDiscountPercent = Number(quote?.coupon.discountPercent || (payAmount > 0 && scaledCouponDiscount > 0 ? Number(((scaledCouponDiscount / payAmount) * 100).toFixed(1)) : 0))
  const hasBillingDiscount = discountPercent > 0 && monthlyBase > monthlyTotal
  const taxLabel = String(quote?.tax?.label || "GST")
  const displayMoney = useCallback((value: number) => formatPrice(value), [])

  const breakdown = useMemo(() => {
    if (quote?.monthly) {
      return {
        cpu: Number(quote.monthly.cpu || 0),
        ram: Number(quote.monthly.ram || 0),
        storage: Number(quote.monthly.storage || 0),
        bandwidth: Number(quote.monthly.bandwidth || 0),
        os: Number(quote.monthly.os || 0),
        region: Number(quote.monthly.region || 0),
      }
    }
    if (!product) return { cpu: 0, ram: 0, storage: 0, bandwidth: 0, os: 0, region: 0 }
    return {
      cpu: Number(product.pricingBreakdown?.cpuPrice || 0),
      ram: Number(product.pricingBreakdown?.ramPrice || 0),
      storage: Number(product.pricingBreakdown?.storagePrice || 0),
      bandwidth: Number(product.pricingBreakdown?.bandwidthPrice || 0),
      os: Number(product.pricingBreakdown?.osPrice || 0),
      region: Number(product.pricingBreakdown?.regionPrice || 0),
    }
  }, [product, quote])

  const visibleBreakdown = [
    { label: "CPU price", value: breakdown.cpu },
    { label: "RAM price", value: breakdown.ram },
    { label: "Storage price", value: breakdown.storage },
    { label: "Bandwidth price", value: breakdown.bandwidth, included: true },
    { label: "OS price", value: breakdown.os, included: true },
    { label: "Region price", value: breakdown.region, included: true },
  ]

  async function applyCoupon() {
    const couponCode = checkoutDraftRef.current.couponCode.trim().toUpperCase()
    if (!product || !couponCode) return
    setCouponApplying(true)
    setCouponError(null)
    try {
      const res = await fetch("/api/coupons/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: couponCode,
          productId: product.id,
          term: checkoutDraftRef.current.termMonths,
          subtotal: quote?.term.subtotal ?? payAmount,
          taxAmount,
          turnstileToken,
          config: isCustomCheckout
            ? {
                cpu: checkoutDraftRef.current.customCpu,
                ram: checkoutDraftRef.current.customRamGb,
                disks: [{ type: checkoutDraftRef.current.diskTier || "nvme", sizeGb: checkoutDraftRef.current.customStorageGb, label: "Disk 1" }],
                storagePoolId: checkoutDraftRef.current.storagePoolId || undefined,
                bandwidth: checkoutDraftRef.current.customBandwidthTb,
                region: checkoutDraftRef.current.region,
              }
            : undefined,
        }),
      })
      const data = await readJsonResponse<{ ok: true; data: any } | { ok: false; error?: string }>(res)
      if (!data) throw new Error("Invalid coupon")
      if (!res.ok || !data.ok) {
        const errorData = data as { ok: false; error?: string }
        throw new Error(errorData.error || "Invalid coupon")
      }
      setCouponDiscount(Number(data.data.discountAmount || 0))
      setCouponValidCode(couponCode)
      toast.success(`Coupon applied (${displayMoney(Number(data.data.discountAmount || 0))} off)`)
    } catch (error: any) {
      setCouponDiscount(0)
      setCouponValidCode(null)
      setCouponError(error?.message || "Failed to apply coupon")
    } finally {
      setCouponApplying(false)
    }
  }

  async function handleCheckout(event?: React.FormEvent<HTMLFormElement>) {
    event?.preventDefault()
    if (checkoutSubmitRef.current) return
    if (!clientDisplayName && !profileLoading) {
      promptForAuth(true)
      return
    }
    if (!product) return
    const current = checkoutDraftRef.current
    const effectiveHostname = String(current.hostname || generatedHostnames[0] || "").trim()
    if (!current.productId && !product.id) return failCheckout("Select a cloud instance before payment.")
    if (!current.osTemplateId) return failCheckout("Select an operating system before payment.")
    if (selectedTemplateIncompatible) return failCheckout("Selected operating system is not available in this region.")
    if (!allowedTerms.includes(current.termMonths)) return failCheckout("Choose a valid billing term before payment.")
    if (passwordStrengthScore(current.password) < 2) return failCheckout("Use at least 8 characters with a mix of letters and numbers.")
    if (!validCheckoutHostname(effectiveHostname)) return failCheckout("Enter a valid Linux hostname before payment.")
    if (displayCurrency !== "INR") return failCheckout("Checkout supports INR payments only.")
    if (!Number.isFinite(payableToday) || payableToday <= 0) return failCheckout("Total payable must be greater than zero.")
    if (profileLoading || hasBillingAddress === false) {
      const label = missingBillingFields.length ? `Missing: ${missingBillingFields.join(", ")}` : "Billing address required before payment."
      return failCheckout(label)
    }
    if (!selectedGateway || !availableGateways.some((gateway) => gateway.code === selectedGateway)) return failCheckout("No payment gateway available.")

    const gatewayAtSubmit = selectedGateway
    console.info("[Checkout][Payment] gateway captured at submit", { selectedGateway: gatewayAtSubmit })

    setCheckoutError(null)
    setPaymentState("initializing")
    checkoutSubmitRef.current = true
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), PAYMENT_START_TIMEOUT_MS)
    const idempotencyKey = checkoutIdempotencyRef.current || storedCheckoutIdempotencyKey() || checkoutIdempotencyKey()
    checkoutIdempotencyRef.current = idempotencyKey
    storeCheckoutIdempotencyKey(idempotencyKey)
    try {
      const paymentQuote = await refreshCheckoutQuote({ signal: controller.signal })
      const paymentToken = paymentQuote?.regional?.token
      if (!paymentToken) throw new Error("Pricing refreshed. Review the total and continue with payment again.")
      trackGaEvent("begin_checkout", {
        value: payAmount,
        currency: displayCurrency,
        items: [{ item_id: product.id, item_name: product.name }],
      })
      console.info("[Checkout][Payment] submit start", {
        productId: product.id,
        term: current.termMonths,
        operatingSystemId: current.osTemplateId,
        paymentMethod: current.paymentMethod,
      })
      const paymentRequestBody = {
        productId: product.id,
        purpose: "order_payment",
        term: current.termMonths,
        amount: payAmount,
        monthlyAmount: monthlyTotal,
        currency: "INR",
        quantity: current.quantity,
        couponCode: couponValidCode || undefined,
        operatingSystemId: current.osTemplateId,
        operatingSystemFamily: selectedOs?.family || current.osFamily,
        operatingSystemVersion: selectedOs?.version || current.osVersion,
        hostname: effectiveHostname,
        config: isCustomCheckout
          ? {
              cpu: current.customCpu,
              ram: current.customRamGb,
              disks: [{ type: current.diskTier || "nvme", sizeGb: current.customStorageGb, label: "Disk 1" }],
              bandwidth: current.customBandwidthTb,
              operatingSystemId: current.osTemplateId,
              operatingSystemName: selectedOs?.name || null,
              operatingSystemFamily: selectedOs?.family || current.osFamily,
              operatingSystemVersion: selectedOs?.version || current.osVersion,
              region: current.region,
              term: current.termMonths,
              nodeId: current.nodeId || undefined,
              diskTier: current.diskTier || undefined,
              storagePoolId: current.storagePoolId || undefined,
              cpuTier: current.cpuTier || undefined,
              addOns: {
                backupEnabled: current.backupEnabled,
                snapshotCount: current.snapshotCount,
                ipv4Count: current.ipv4Count,
                estimatedMonthly: addOnMonthly,
              },
            }
          : undefined,
        addOns: {
          backupEnabled: current.backupEnabled,
          snapshotCount: current.snapshotCount,
          ipv4Count: current.ipv4Count,
          estimatedMonthly: addOnMonthly,
        },
        adminUsername: selectedAdminUser,
        password: current.password,
        accessMethod: "PASSWORD",
        paymentMethod: "gateway",
        preferredGateway: gatewayAtSubmit,
        priceToken: paymentToken,
        idempotencyKey,
        redirectTo: `${globalThis.location.pathname}${globalThis.location.search}`,
        turnstileToken,
      }
      let res = await fetch("/api/checkout/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify(paymentRequestBody),
      })
      let data = await readJsonResponse<any>(res)
      if (res.ok) {
        const checkoutSessionId = firstPaymentString(data?.checkoutSessionId, data?.checkout_session_id)
        if (!checkoutSessionId) throw new Error("Checkout session was not returned.")
        res = await fetch("/api/payments/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            checkoutSessionId,
            preferredGateway: gatewayAtSubmit,
            idempotencyKey,
            currency: "INR",
          }),
        })
        data = await readJsonResponse<any>(res)
      }
      window.clearTimeout(timeout)
      console.info("[Checkout][Payment] API response", {
        ok: res.ok,
        status: res.status,
        success: data?.success,
        checkoutSessionId: data?.checkoutSessionId || data?.checkout_session_id || null,
        gateway: data?.gateway || null,
        orderId: data?.orderId || null,
        invoiceId: data?.invoiceId || null,
        gatewayOrderId: data?.gatewayOrderId || data?.cashfreeOrderId || null,
        hasPaymentSessionId: Boolean(data?.paymentSessionId || data?.payment_session_id),
        hasPaymentUrl: Boolean(data?.paymentUrl || data?.payment_url || data?.checkoutUrl || data?.checkout_url || data?.redirectUrl || data?.redirect_url),
      })
      if (!res.ok) {
        if (data?.code === "login_required") {
          promptForAuth(true)
          return
        }
        if (data?.code === "profile_incomplete") {
          setPaymentState("error")
          toast.error("Please complete your profile (email and phone) before payment.")
          globalThis.location.assign("/client-area/settings")
          return
        }
        if (data?.code === "billing_address_required") {
          const message = data?.message || data?.error || "Billing address required before payment."
          setPaymentState("error")
          setHasBillingAddress(false)
          setCheckoutError(message)
          toast.error(message)
          return
        }
        if (data?.code === "email_verification_required") {
          const message = data?.message || data?.error || "Please verify your email before payment. We sent a verification link to your inbox."
          setPaymentState("error")
          setCheckoutError(message)
          toast.error(message)
          return
        }
        if (isPricingRefreshCode(data?.code)) {
          await refreshCheckoutQuote().catch((quoteRefreshError) => {
            console.warn("[Checkout][Payment] quote refresh after token rejection failed", quoteRefreshError)
          })
          const message = "Pricing was refreshed. Review the total and continue with payment again."
          setPaymentState("error")
          setCheckoutError(message)
          toast.error(message)
          return
        }
        const requestId = String(data?.requestId || res.headers.get("x-request-id") || "").trim()
        const mapped = paymentClientMessage({
          code: data?.code,
          message: data?.message || data?.error,
          fallback: "Payments are temporarily unavailable. Please try again shortly.",
        })
        throw new Error(requestId ? `${mapped} (Ref: ${requestId})` : mapped)
      }
      validatePaymentStartResponse(data)
      const returnedGateway = String(data?.gateway || "").toLowerCase()
      const gatewayCheck = returnedGateway ? validateReturnedGateway(returnedGateway, gatewayAtSubmit) : { ok: true }
      if (!gatewayCheck.ok) {
        console.error("[Checkout][Payment] PAYMENT_GATEWAY_MISMATCH", {
          selectedGateway: gatewayAtSubmit,
          requestedGateway: gatewayAtSubmit,
          returnedGateway,
          orderId: data?.orderId || data?.gatewayOrderId || null,
          checkoutSessionId: data?.checkoutSessionId || null,
          timestamp: new Date().toISOString(),
        })
        trackGaEvent("payment_gateway_mismatch", { requested: gatewayAtSubmit, returned: returnedGateway })
        checkoutSubmitRef.current = false
        setPaymentState("error")
        const mismatchMessage = paymentClientMessage({
          code: "GATEWAY_MISMATCH",
          message: "Payment gateway mismatch detected. The payment session was not opened; no charge was made. If this persists, contact support.",
          fallback: "Payment gateway mismatch detected. The payment session was not opened; no charge was made. If this persists, contact support.",
        })
        setCheckoutError(mismatchMessage)
        toast.error(mismatchMessage)
        return
      }
      setPaymentState("redirecting")
      await startPaymentRedirect(data, { push: router.push, expectedGateway: gatewayAtSubmit })
      storeCheckoutIdempotencyKey(null)
      checkoutIdempotencyRef.current = null
      setPaymentState("waiting")
      setCheckoutError("Waiting for payment confirmation...")
    } catch (error) {
      window.clearTimeout(timeout)
      if (error instanceof DOMException && error.name === "AbortError" && idempotencyKey) {
        try {
          const statusRes = await fetch(`/api/payments/status?orderId=${encodeURIComponent(idempotencyKey)}`, { cache: "no-store" })
          const statusData = await readJsonResponse<any>(statusRes)
          const status = String(statusData?.status || "").toLowerCase()
          if (statusRes.ok && status === "success" && statusData?.verified === true && statusData?.redirectUrl) {
            setPaymentState("verified")
            router.push(statusData.redirectUrl)
            return
          }
          if (statusRes.ok && ["pending", "processing"].includes(status)) {
            const message = status === "processing" ? "Verifying payment..." : "Waiting for payment confirmation..."
            setPaymentState(status === "processing" ? "verifying" : "waiting")
            setCheckoutError(message)
            toast.info(message)
            return
          }
          if (statusRes.ok && ["failed", "cancelled", "expired"].includes(status)) {
            const message = statusData?.message || statusData?.error || "Payment failed."
            setPaymentState("error")
            setCheckoutError(message)
            toast.error(message)
            return
          }
        } catch (recoveryError) {
          if (!(recoveryError instanceof Error)) throw recoveryError
          console.warn("[Checkout][Payment] timeout recovery failed", recoveryError.message)
        }
      }
      const rawMessage = error instanceof Error ? error.message : ""
      const message = error instanceof DOMException && error.name === "AbortError"
        ? "Payment request timed out. Please try again."
        : /fetch failed|failed to fetch|networkerror/i.test(rawMessage)
          ? "The payment service could not be reached. Check your connection and try again."
          : paymentClientMessage({ message: rawMessage, fallback: "Checkout failed" })
      console.error("[Checkout][Payment] submit failed", error)
      setCheckoutError(message)
      toast.error(message)
      setPaymentState("error")
    } finally {
      checkoutSubmitRef.current = false
    }
  }

  function failCheckout(message: string) {
    setPaymentState("error")
    setCheckoutError(message)
    toast.error(message)
  }

  return (
    <>
      {phonePeBridgeUrl ? <PhonePeBridgeModal bridgeUrl={phonePeBridgeUrl} onClose={() => setPhonePeBridgeUrl(null)} /> : null}
      <Dialog open={authModalOpen} onOpenChange={setAuthModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Continue your order</DialogTitle>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:justify-start">
            <Button asChild>
              <Link href={`/login?next=${encodeURIComponent(currentCheckoutUrl())}`}>Login</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={`/register?next=${encodeURIComponent(currentCheckoutUrl())}`}>Create Account</Link>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <header className="pt-8 sm:pt-10">
        <Container>
          <Link href="/compute-instances" className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Cloud Instances
          </Link>
          <div className="mt-6 flex flex-wrap items-center gap-2">
            <Badge variant="outline">Cloud Deployment</Badge>
            <Badge variant="outline" className="border-accent/40 text-accent">Datacenter fabric up to 1.8 Tbps</Badge>
          </div>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">{checkoutTitle}</h1>
          <p className="mt-3 max-w-2xl text-base text-muted-foreground">
            High-performance NVMe-backed cloud compute with dedicated resources and predictable bandwidth included upfront.
          </p>
        </Container>
      </header>

      <section className="py-8 sm:py-12">
        <Container>
          {!product ? (
            <div className="glass rounded-2xl p-8">
              <p className="text-base font-medium text-foreground">{bootstrap.bootstrapError?.message || "Selected cloud instance is unavailable."}</p>
              {bootstrap.bootstrapError?.code ? (
                <p className="mt-2 font-mono text-xs text-muted-foreground">Code: {bootstrap.bootstrapError.code}</p>
              ) : null}
              <Button asChild className="mt-5"><Link href="/pricing">View plans</Link></Button>
            </div>
          ) : (
            <form data-cloud-checkout-form onSubmit={handleCheckout} className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_390px]">
              <main className="space-y-6">
                <Panel>
                  <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">Selected instance plan</p>
                      <h2 className="mt-1 text-2xl font-semibold">{instanceName}</h2>
                      {instanceSpecs ? <p className="mt-2 text-sm text-muted-foreground">{instanceSpecs}</p> : null}
                      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                        High-capacity backbone with generous included bandwidth and no surprise egress pricing.
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="outline">{getTermLabel(selectedTerm)}</Badge>
                      <Badge variant="outline">Direct deploy</Badge>
                    </div>
                  </div>
                  <dl className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <Detail icon={Cpu} label="vCPU" value={`${displayCpu} cores`} />
                    <Detail icon={HardDrive} label="Memory" value={`${displayRam} GB`} />
                    <Detail icon={Database} label="Storage" value={`${displayStorage} GB ${String(checkoutDraft.diskTier || product.storageType || "NVMe").toUpperCase()}`} />
                    <Detail icon={Globe2} label="Bandwidth" value={displayBandwidthLabel} />
                  </dl>
                </Panel>

                <Panel>
                  <SectionTitle title="Billing period" description="Choose a longer term to lower the monthly effective price." />
                  <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {allowedTerms.map((item) => {
                      const discount = Number(billingDiscounts[item] || 0)
                      const selected = selectedTerm === item
                      return (
                        <button type="button"
                          key={item}
                          data-testid="billing-term-option"
                          onClick={() => {
                            if (process.env.NODE_ENV !== "production") console.debug("[CheckoutContent] billing term selected without navigation", { term: item })
                            markDraftChange("termMonths", item)
                          }}
                          className={`rounded-xl border p-4 text-left transition-[background,border-color,transform,color] duration-150 hover:-translate-y-px ${selected ? "selected-item" : "border-[var(--border-primary)] bg-[var(--surface-subtle)] text-[var(--text-muted)] hover:border-[var(--border-hover)] hover:bg-[rgba(255,255,255,0.04)] hover:text-[var(--text-primary)]"}`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <span className="font-medium">{getTermLabel(item)}</span>
                            {discount > 0 ? <Badge variant="outline" className="text-cyan-400">Save {discount}%</Badge> : null}
                          </div>
                          <p className="mt-2 text-xs">Manual renewal cycle: {item} month{item === 1 ? "" : "s"}.</p>
                        </button>
                      )
                    })}
                  </div>
                </Panel>

                <Panel>
                  <SectionTitle title="Choose operating system" description="Pick an enabled server image. Disabled admin templates are hidden automatically." />
                  <div className="mt-4 flex gap-2 border-b border-border/40 pb-3 text-sm">
                    <Badge>Operating Systems</Badge>
                    <Badge variant="outline" className="text-muted-foreground">Applications coming soon</Badge>
                  </div>
                  {operatingSystems.length === 0 ? (
                    <p className="mt-5 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                      No operating system templates are available. Please contact support.
                    </p>
                  ) : (
                    <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_260px]">
                      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                        {osFamilies.map((family) => {
                          const selected = (selectedOsFamily || selectedOs?.family) === family.family
                          const familyCompatible = family.items.some((item) => templateCompatible(item))
                          return (
                            <button type="button"
                              key={family.family}
                              data-testid="os-family-option"
                              disabled={!familyCompatible}
                              onClick={() => {
                                const compatibleItems = family.items.filter((item) => templateCompatible(item))
                                const preferred = compatibleItems.find((item) => item.recommended) || compatibleItems[0]
                                if (!preferred) return
                                if (process.env.NODE_ENV !== "production") console.debug("[CheckoutContent] OS family selected without navigation", { family: family.family, osTemplateId: preferred?.id || "" })
                                updateDraft({
                                  ...checkoutDraftRef.current,
                                  osFamily: family.family,
                                  osTemplateId: preferred?.id || "",
                                  osVersion: preferred?.version || preferred?.name || "",
                                  adminUser: preferred?.defaultUsername || checkoutDraftRef.current.adminUser || "root",
                                })
                              }}
                              className={`min-h-28 rounded-xl border p-4 text-left transition-[background,border-color,transform,color] duration-150 hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-55 ${selected ? "selected-item" : "border-[var(--border-primary)] bg-[var(--surface-subtle)] text-[var(--text-primary)] hover:border-[var(--border-hover)] hover:bg-[rgba(255,255,255,0.04)]"}`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--border-primary)] bg-[var(--surface-hover)] shadow-sm shadow-black/20">
                                  <Image
                                    src={getResolvedOsIcon({
                                      name: family.label,
                                      family: family.family,
                                      familyLabel: family.label,
                                      iconUrl: family.iconUrl,
                                    })}
                                    alt=""
                                    width={32}
                                    height={32}
                                    className="h-8 w-8 object-contain"
                                    onError={handleOsIconError}
                                    unoptimized
                                  />
                                </div>
                                {family.items.some((item) => item.recommended) ? <Badge variant="outline">Recommended</Badge> : null}
                              </div>
                              <p className="mt-3 font-medium">{family.label}</p>
                              <p className="mt-1 text-xs text-[var(--text-muted)]">{family.description}</p>
                              {!familyCompatible ? <p className="mt-2 text-xs text-amber-300">Not available in {checkoutDraft.region || defaultRegion}</p> : null}
                            </button>
                          )
                        })}
                      </div>
                      <div className="rounded-xl border border-[var(--border-primary)] bg-[var(--surface-subtle)] p-4">
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">Version selector</p>
                        <div className="mt-3 space-y-2">
                          {familyVersions.map((os) => (
                            <button type="button"
                              key={os.id}
                              data-testid="os-version-option"
                              disabled={!templateCompatible(os)}
                              onClick={() => {
                                if (!templateCompatible(os)) return
                                if (process.env.NODE_ENV !== "production") console.debug("[CheckoutContent] OS version selected without navigation", { osTemplateId: os.id })
                                updateDraft({
                                  ...checkoutDraftRef.current,
                                  osTemplateId: os.id,
                                  osFamily: os.family || checkoutDraftRef.current.osFamily,
                                  osVersion: os.version || os.name || "",
                                  adminUser: os.defaultUsername || checkoutDraftRef.current.adminUser || "root",
                                })
                              }}
                              className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition-[background,border-color,transform,color] duration-150 hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-55 ${operatingSystemId === os.id ? "selected-item" : "border-[var(--border-primary)] bg-transparent hover:border-[var(--border-hover)] hover:bg-[rgba(255,255,255,0.04)]"}`}
                            >
                              <span className="flex items-start gap-2">
                                <Image src={getResolvedOsIcon(os)} alt="" width={20} height={20} className="mt-0.5 h-5 w-5 object-contain" onError={handleOsIconError} unoptimized />
                                <span>
                                  <span className="font-medium">{os.version || os.name}</span>
                                  <span className="ml-2 text-xs text-muted-foreground">{os.recommended ? "Recommended" : ""}</span>
                                </span>
                              </span>
                              {os.eolWarningText ? <p className="mt-1 text-xs text-amber-300">{os.eolWarningText}</p> : null}
                              {!templateCompatible(os) ? <p className="mt-1 text-xs text-amber-300">Not available in {checkoutDraft.region || defaultRegion}</p> : null}
                            </button>
                          ))}
                        </div>
                        <p className="mt-4 rounded-lg border border-[var(--border-primary)] bg-[var(--surface-subtle)] p-3 text-xs text-[var(--text-muted)]">
                          Default login for this image is: <span className="font-medium text-foreground">{selectedAdminUser}</span>
                        </p>
                      </div>
                    </div>
                  )}
                </Panel>

                <Panel>
                  <SectionTitle title="Access Credentials" description="Set the admin login credentials for this instance." />
                  <div className="mt-5 grid gap-4 sm:grid-cols-2">
                    <QuantityStepper
                      label="Quantity"
                      value={quantity}
                      onChange={(value) => markDraftInputChange("quantity", value)}
                      onFocus={() => focusDraftField("quantity")}
                      onBlur={() => blurDraftField("quantity")}
                    />
                    <FieldInput label="Hostname" field="hostname" value={checkoutDraft.hostname} placeholder={generatedHostnames[0] || "instance-hostname"} onFocus={focusDraftField} onBlur={blurDraftField} onChange={markDraftInputChange} />
                    <FieldInput label="Admin user" field="adminUser" value={selectedAdminUser} readOnly onFocus={focusDraftField} onBlur={blurDraftField} onChange={markDraftInputChange} />
                    <div className="sm:col-span-2 rounded-xl border border-[var(--border-primary)] bg-[rgba(255,255,255,0.035)] p-4 text-sm shadow-sm shadow-black/20 backdrop-blur">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 text-muted-foreground"><KeyRound className="h-4 w-4" />Generated hostnames</div>
                        <Badge variant="outline">{generatedHostnames.length} VM{generatedHostnames.length === 1 ? "" : "s"}</Badge>
                      </div>
                      <div className="mt-3 max-h-52 space-y-2 overflow-y-auto pr-1">
                        {generatedHostnames.map((hostname, index) => (
                          <div key={hostname} className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-border/40 bg-background/40 px-3 py-2">
                            <span className="min-w-0 truncate font-mono text-xs text-foreground sm:text-sm">{hostname}</span>
                            <Button
                              type="button"
                              variant={copiedSecret === `host-${index}` ? "default" : "outline"}
                              size="sm"
                              className="h-8 shrink-0 gap-1.5"
                              onClick={() => void copyCheckoutSecret(hostname, `host-${index}`, "Hostname copied")}
                            >
                              <Copy className="h-3.5 w-3.5" />
                              {copiedSecret === `host-${index}` ? "Copied" : "Copy"}
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="sm:col-span-2 space-y-2">
                      <label className="block text-xs font-medium uppercase tracking-wide text-muted-foreground">Password</label>
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <input
                            className="h-10 w-full rounded-md border border-[var(--border-primary)] bg-[var(--surface-subtle)] px-3 pr-10 text-sm"
                            type={showPassword ? "text" : "password"}
                            data-testid="checkout-password"
                            value={checkoutDraft.password}
                            placeholder="Minimum 8 characters"
                            onFocus={() => focusDraftField("password")}
                            onBlur={() => blurDraftField("password")}
                            onChange={(event) => markDraftInputChange("password", event.target.value)}
                          />
                          <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Hide password" : "Show password"}>
                            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                        </div>
                        <Button type="button" variant="outline" onClick={generateCheckoutPassword}>Generate</Button>
                        <Button type="button" variant="outline" size="icon" onClick={() => void copyCheckoutSecret(checkoutDraft.password, "password", "Password copied")} disabled={!checkoutDraft.password}>
                          <Copy className="h-4 w-4" />
                        </Button>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted">
                        <div className={`h-1.5 rounded-full transition-all ${checkoutDraft.password.length >= 14 ? "w-full bg-emerald-500" : checkoutDraft.password.length >= 8 ? "w-2/3 bg-amber-500" : "w-1/3 bg-destructive"}`} />
                      </div>
                      <div className="grid gap-1.5 rounded-lg border border-border/40 bg-background/30 p-3 text-xs text-muted-foreground sm:grid-cols-2">
                        {passwordRequirements.map((item) => (
                          <span key={item.label} className={`flex items-center gap-1.5 ${item.met ? "text-emerald-300" : ""}`}>
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            {item.label}
                          </span>
                        ))}
                        <span className={`flex items-center gap-1.5 ${passwordStrongEnough ? "text-emerald-300" : ""}`}>
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Strong enough for provisioning
                        </span>
                      </div>
                      {quantity > 1 ? <p className="text-xs text-amber-300">Password will apply to all selected VMs.</p> : null}
                    </div>
                    <div className="sm:col-span-2 rounded-xl border border-[var(--border-primary)] bg-[var(--surface-subtle)] p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">VM access preview</p>
                          <p className="mt-1 text-sm text-muted-foreground">Primary IP will be assigned during provisioning.</p>
                        </div>
                        {bulkDiscountApplied ? <Badge variant="outline" className="border-cyan-500/50 bg-cyan-500/10 text-cyan-300">Bulk discount applied (10% OFF)</Badge> : null}
                      </div>
                      <div className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
                        <PreviewSecret label="IP" value="Pending assignment" onCopy={copyCheckoutSecret} copyKey="preview-ip" />
                        <PreviewSecret label="USER" value={selectedAdminUser} onCopy={copyCheckoutSecret} copyKey="preview-user" />
                        <PreviewSecret label="PASSWORD" value={accessPreviewPassword} copyValue={checkoutDraft.password} onCopy={copyCheckoutSecret} copyKey="preview-password" disabled={!checkoutDraft.password} />
                      </div>
                    </div>
                  </div>
                </Panel>

                {profileLoading || hasBillingAddress === false ? (
                  <Panel>
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex gap-3">
                        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-amber-400/40 bg-amber-400/10 text-amber-300">
                          <AlertTriangle className="h-4 w-4" />
                        </div>
                        <div>
                          <h2 className="text-base font-semibold">Billing address required before payment.</h2>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {missingBillingFields.length
                              ? `Complete these fields in your profile: ${missingBillingFields.join(", ")}.`
                              : "Add your billing address in account settings to continue checkout."}
                          </p>
                        </div>
                      </div>
                      <Button type="button" variant="outline" asChild>
                        <Link href={`/client-area/settings/profile?missing=billing&return=${encodeURIComponent(globalThis?.location?.pathname ? `${globalThis.location.pathname}${globalThis.location.search}` : "/checkout")}`}>Complete billing address</Link>
                      </Button>
                    </div>
                  </Panel>
                ) : savedBillingAddress ? (
                  <Panel>
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Billing address</p>
                        <p className="mt-2 text-sm font-medium text-foreground">{savedBillingAddress.line1}</p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {savedBillingAddress.city}, {savedBillingAddress.state} {savedBillingAddress.postalCode}, {savedBillingAddress.country}
                        </p>
                      </div>
                      <Button type="button" variant="outline" asChild>
                        <Link href={`/client-area/settings/profile?return=${encodeURIComponent(globalThis?.location?.pathname ? `${globalThis.location.pathname}${globalThis.location.search}` : "/checkout")}`}>Edit in account settings</Link>
                      </Button>
                    </div>
                  </Panel>
                ) : null}
              </main>

              <aside className="lg:sticky lg:top-24 lg:self-start">
                <div className="glass glass-strong rounded-2xl border border-border/60 p-6 shadow-2xl shadow-black/20 sm:p-8">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Billing summary</h3>
                      <p className="mt-1 text-xs text-muted-foreground">Secure cloud instance checkout</p>
                    </div>
                    {hasBillingDiscount ? <Badge variant="outline" className="border-cyan-500/50 bg-cyan-500/10 text-cyan-300">Save {discountPercent}%</Badge> : null}
                  </div>
                  <div className="mt-6 rounded-xl border border-border/50 bg-background/40 p-4">
                    {hasBillingDiscount ? (
                      <>
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">Original price</p>
                        <p className="mt-1 text-sm text-muted-foreground line-through">{displayMoney(monthlyBase)}</p>
                      </>
                    ) : null}
                    <div className={`${hasBillingDiscount ? "mt-3" : ""} flex flex-wrap items-end gap-x-2 gap-y-1`}>
                      <span className="text-4xl font-semibold tracking-tight text-foreground">{displayMoney(monthlyTotal)}</span>
                      <span className="pb-1 text-sm font-medium text-muted-foreground">/mo</span>
                    </div>
                  </div>
                  {quoteLoading ? <p className="mt-2 text-xs text-muted-foreground">Updating price...</p> : null}
                  <p className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
                    <Clock className="h-3.5 w-3.5" />
                    {displayMoney(hourlyPrice)}/hr effective
                  </p>
                  <div className="mt-6 flex flex-col gap-3 border-t border-border/70 pt-5 text-sm">
                    <SummaryRow k="Product" v={instanceName} />
                    <SummaryRow k="Region" v={checkoutDraft.region || defaultRegion} />
                    <SummaryRow k="OS" v={osSummary} />
                    <SummaryRow k="Billing term" v={getTermLabel(selectedTerm)} />
                    <SummaryRow k="Quantity" v={`${quantity} VM${quantity === 1 ? "" : "s"}`} />
                    <SummaryRow k="vCPU" v={`${displayCpu} cores`} />
                    <SummaryRow k="RAM" v={`${displayRam} GB`} />
                    <SummaryRow k="Storage" v={`${displayStorage} GB ${String(checkoutDraft.diskTier || product.storageType || "NVMe").toUpperCase()}`} />
                    <SummaryRow k="Bandwidth" v={displayBandwidthLabel} />
                    {product?.backupEnabled ? <SummaryRow k="Backup" v={checkoutDraft.backupEnabled ? `${displayMoney(Number(product.backupPrice || 0))}/mo` : "Off"} /> : null}
                    {product?.snapshotEnabled ? <SummaryRow k="Snapshots" v={`${checkoutDraft.snapshotCount || 0} selected`} /> : null}
                    {Number(product?.extraIpv4Price || 0) > 0 ? <SummaryRow k="IPv4" v={`${checkoutDraft.ipv4Count || 1} address${Number(checkoutDraft.ipv4Count || 1) === 1 ? "" : "es"}`} /> : null}
                    <SummaryRow k="Datacenter network" v="Up to 1.8 Tbps aggregate capacity" />
                  </div>
                  {(product?.backupEnabled || product?.snapshotEnabled || Number(product?.extraIpv4Price || 0) > 0) ? (
                    <div className="mt-4 space-y-3 rounded-xl border border-border/50 bg-background/35 p-4 text-sm">
                      {product.backupEnabled ? (
                        <label className="flex items-center justify-between gap-3">
                          <span>Backup</span>
                          <input type="checkbox" checked={checkoutDraft.backupEnabled} onChange={(event) => markDraftChange("backupEnabled", event.target.checked)} />
                        </label>
                      ) : null}
                      {product.snapshotEnabled ? (
                        <FieldInput label="Snapshots" field="snapshotCount" type="number" value={String(checkoutDraft.snapshotCount)} onFocus={focusDraftField} onBlur={blurDraftField} onChange={markDraftNumericChange} />
                      ) : null}
                      {Number(product.extraIpv4Price || 0) > 0 ? (
                        <FieldInput label="IPv4 Count" field="ipv4Count" type="number" value={String(checkoutDraft.ipv4Count)} onFocus={focusDraftField} onBlur={blurDraftField} onChange={markDraftNumericChange} />
                      ) : null}
                      <SummaryRow k="Add-on estimate" v={`${displayMoney(addOnMonthly)}/mo`} />
                    </div>
                  ) : null}
                  <div className="mt-5 rounded-xl border border-[var(--border-selected)] bg-[var(--accent-subtle)] p-4">
                    <p className="text-sm font-semibold text-foreground">Pricing Breakdown</p>
                    <div className="mt-3 space-y-2 border-t border-[var(--border-selected)] pt-3 text-xs text-[var(--text-muted)]">
                      <SummaryRow k="Subtotal" v={displayMoney(payAmount)} />
                      {scaledCouponDiscount > 0 ? (
                        <SummaryRow
                          k={`Coupon${couponValidCode ? ` (${couponValidCode})` : ""}`}
                          v={`- ${displayMoney(scaledCouponDiscount)} (${couponDiscountPercent.toFixed(1)}% OFF)`}
                          tone="success"
                        />
                      ) : null}
                      {bulkDiscountAmount > 0 ? <SummaryRow k="Bulk discount" v={`- ${displayMoney(bulkDiscountAmount)} (10% OFF)`} tone="success" /> : null}
                      <SummaryRow k="Taxable amount" v={displayMoney(taxableAmount)} />
                      <SummaryRow k={`${taxLabel} (${quote?.tax.percent ?? 0}%)`} v={displayMoney(taxAmount)} />
                      <div className="mt-3 flex items-center justify-between gap-3 border-t border-[var(--border-selected)] pt-3">
                        <span className="text-sm font-semibold text-foreground">Total payable</span>
                        <span className="text-right">
                          <span className="block text-2xl font-semibold tracking-tight text-foreground">{displayMoney(payableToday)}</span>
                          {quote?.regional?.approxInrLabel ? <span className="block text-xs text-muted-foreground">{quote.regional.approxInrLabel}</span> : null}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 rounded-xl border border-border/50 bg-foreground/[0.03] p-4 text-sm">
                    <SummaryRow k="Renews on" v={renewalDate} />
                    <div className="mt-2">
                      <SummaryRow k="Renewal amount" v={displayMoney(renewalAmount)} />
                    </div>
                    {quoteError ? <div className="mt-2 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-destructive">{quoteError}</div> : null}
                  </div>
                  <button type="button" className="mt-4 flex w-full items-center justify-between rounded-lg border border-[var(--border-primary)] px-3 py-2 text-xs font-medium text-[var(--accent-primary)] transition hover:border-[var(--border-hover)] hover:bg-[rgba(255,255,255,0.04)]" onClick={() => setShowBreakdown((value) => !value)}>
                    View price breakdown
                    <ChevronDown className={`h-3.5 w-3.5 transition ${showBreakdown ? "rotate-180" : ""}`} />
                  </button>
                  {showBreakdown ? (
                    <div className="mt-3 rounded-xl border border-border/50 bg-background/30 p-4 text-xs">
                      {visibleBreakdown.map((item) => (
                        <MonthlyPriceRow key={item.label} label={item.label} value={item.value} included={item.included} formatMoney={displayMoney} />
                      ))}
                      <PriceRow label="Monthly total" value={monthlyTotal} suffix="/mo" formatMoney={displayMoney} />
                      <PriceRow label="Term subtotal" value={payAmount} formatMoney={displayMoney} />
                      <PriceRow label="Term discount" value={termDiscount ? -termDiscount : 0} highlight={Boolean(termDiscount)} formatMoney={displayMoney} />
                      <PriceRow label={couponValidCode ? `Coupon (${couponValidCode})` : "Coupon discount"} value={scaledCouponDiscount > 0 ? -scaledCouponDiscount : 0} highlight={scaledCouponDiscount > 0} suffix={scaledCouponDiscount > 0 ? `(${couponDiscountPercent.toFixed(1)}% OFF)` : undefined} formatMoney={displayMoney} />
                      <PriceRow label="Bulk discount" value={bulkDiscountAmount > 0 ? -bulkDiscountAmount : 0} highlight={bulkDiscountAmount > 0} suffix={bulkDiscountAmount > 0 ? "(10% OFF)" : undefined} formatMoney={displayMoney} />
                      <PriceRow label="Taxable amount" value={taxableAmount} formatMoney={displayMoney} />
                      <PriceRow label={`${taxLabel} (${quote?.tax.percent ?? 0}%)`} value={taxAmount} formatMoney={displayMoney} />
                      <PriceRow label="Effective monthly" value={effectiveMonthly} suffix="/mo effective" formatMoney={displayMoney} />
                    </div>
                  ) : null}
                  <div className="mt-4 flex items-end gap-2">
                    <div className="flex-1">
                      <label className="mb-1 block text-xs text-muted-foreground">Coupon</label>
                      <input
                        data-testid="coupon-input"
                        className="h-10 w-full rounded-md border border-[var(--border-primary)] bg-[var(--surface-subtle)] px-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-placeholder)] focus:border-[var(--accent-primary)] focus:outline-none focus:ring-[3px] focus:ring-[rgba(20,184,166,0.12)]"
                        placeholder="Enter coupon code"
                        value={checkoutDraft.couponCode}
                        onFocus={() => focusDraftField("couponCode")}
                        onBlur={() => blurDraftField("couponCode")}
                        onChange={(e) => {
                          const next = e.target.value.toUpperCase()
                          setCouponError(null)
                          markDraftInputChange("couponCode", next)
                        }}
                      />
                    </div>
                    <Button type="button" variant="outline" data-testid="coupon-apply" onClick={applyCoupon} disabled={couponApplying || (captchaRequired && !turnstileToken)}>{couponApplying ? "Applying..." : "Apply"}</Button>
                  </div>
                  {couponValidCode ? <p className="mt-2 text-xs text-cyan-400">Applied coupon: {couponValidCode}</p> : null}
                  {couponError ? <p className="mt-2 text-xs text-destructive">{couponError}</p> : null}
                  <div className="mt-5 space-y-2">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Payment method</p>
                    {availableGateways.map((gateway) => (
                      <button
                        key={gateway.code}
                        type="button"
                        onClick={() => handleGatewayChange(gateway.code)}
                        className={`flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left text-sm transition-[background,border-color,transform,color] duration-150 hover:-translate-y-px ${selectedGateway === gateway.code ? "selected-item" : "border-[var(--border-primary)] bg-[var(--surface-subtle)] hover:border-[var(--border-hover)] hover:bg-[rgba(255,255,255,0.04)]"}`}
                      >
                        <GatewayBrandMark gateway={gateway} />
                        <span>
                          <span className="block font-medium">Pay with {gateway.label}</span>
                          <span className="text-xs text-muted-foreground">Secure {gateway.label} Checkout</span>
                          <span className="block text-xs text-muted-foreground">Amount: {displayMoney(payableToday)}</span>
                        </span>
                      </button>
                    ))}
                    {!availableGateways.length ? <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">No payment gateway available.</p> : null}
                  </div>
                  {checkoutError ? <div className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{checkoutError}</div> : null}
                  {!clientDisplayName ? (
                    <div className="mt-4">
                      <GoogleOAuthButton role="client" nextTo={currentCheckoutUrl()} />
                    </div>
                  ) : null}
                  <div className="mt-6 flex flex-col gap-2">
                    <TurnstileWidget value={turnstileToken} onChange={setTurnstileToken} action="checkout" surface="checkout" siteKey={turnstile.siteKey} />
                    <Button type="submit" disabled={submitting || profileLoading || hasBillingAddress === false || !operatingSystemId || operatingSystems.length === 0 || !selectedGateway || (Boolean(clientDisplayName) && captchaRequired && !turnstileToken)} className="w-full gap-1.5">
                      {paymentState === "initializing" ? <><Spinner className="h-4 w-4" />Initializing {gatewayDisplayName(selectedGateway || "")}...</> : null}
                      {paymentState === "redirecting" ? <><Spinner className="h-4 w-4" />Opening payment gateway...</> : null}
                      {paymentState === "waiting" ? <><Spinner className="h-4 w-4" />Waiting for payment...</> : null}
                      {paymentState === "verifying" ? <><Spinner className="h-4 w-4" />Verifying payment...</> : null}
                      {paymentState === "verified" ? <><CheckCircle2 className="h-4 w-4" />Payment verified</> : null}
                      {paymentState === "error" ? <>Payment initialization failed<ArrowRight className="h-4 w-4" /></> : null}
                      {paymentState === "idle" ? <>Continue with {selectedGateway === "razorpay" ? "Razorpay" : selectedGateway === "phonepe" ? "PhonePe" : "Cashfree"}<ArrowRight className="h-4 w-4" /></> : null}
                    </Button>
                    <Button type="button" variant="outline" asChild className="w-full">
                      <Link href="/pricing"><ArrowLeft className="mr-2 h-4 w-4" />View plans</Link>
                    </Button>
                  </div>
                  <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
                    <CheckCircle2 className="h-4 w-4 text-accent" />
                    {selectedGateway === "razorpay" ? "Secure Razorpay Checkout" : selectedGateway === "phonepe" ? "Secure PhonePe Checkout" : selectedGateway === "cashfree" ? "Secure Cashfree Checkout" : "No payment gateway available"}
                  </div>
                </div>
              </aside>
            </form>
          )}
        </Container>
      </section>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Product",
          "name": `${instanceName} Cloud Instance`,
          "description": `High-performance ${brandName} instance with NVMe storage, dedicated vCPU and RAM, and predictable monthly pricing.`,
          "brand": { "@type": "Brand", "name": brandName },
          "offers": {
            "@type": "Offer",
            "price": String(payableToday || product?.price1m || 0),
            "priceCurrency": currency,
            "availability": "https://schema.org/InStock",
            "url": `${siteUrl}/checkout?product=${product?.slug || checkoutDraft.productSlug}&term=${selectedTerm}`,
          },
        })}}
      />
    </>
  )
}

function passwordStrengthScore(password: string) {
  if (password.length < 8) return 0
  let classes = 0
  if (/[A-Z]/.test(password)) classes++
  if (/[a-z]/.test(password)) classes++
  if (/[0-9]/.test(password)) classes++
  if (/[^A-Za-z0-9]/.test(password)) classes++
  if (classes >= 4 && password.length >= 12) return 4
  if (classes >= 3 && password.length >= 10) return 3
  if (classes >= 2) return 2
  return 1
}

function passwordRequirementRows(password: string) {
  return [
    { label: "At least 8 characters", met: password.length >= 8 },
    { label: "Uppercase letter", met: /[A-Z]/.test(password) },
    { label: "Lowercase letter", met: /[a-z]/.test(password) },
    { label: "Number", met: /[0-9]/.test(password) },
    { label: "Symbol", met: /[^A-Za-z0-9]/.test(password) },
  ]
}

function supportedTemplateIdsForRegion(product: Product | null | undefined, regionName: string) {
  const regions = Array.isArray(product?.regions) ? product!.regions : []
  const wanted = String(regionName || "").trim().toLowerCase()
  if (!wanted) return null
  for (const region of regions) {
    if (!region || typeof region === "string") continue
    const name = String(region.name || region.slug || "").trim().toLowerCase()
    if (!name || (name !== wanted && region.slug !== wanted)) continue
    const ids = Array.isArray(region.supportedTemplateIds)
      ? region.supportedTemplateIds
      : Array.isArray(region.supportedTemplates)
        ? region.supportedTemplates
        : []
    const normalized = ids.map(String).filter(Boolean)
    return normalized.length ? new Set(normalized) : null
  }
  return null
}

function Panel({ children }: { children: React.ReactNode }) {
  return <div className="glass rounded-2xl border border-[var(--border-primary)] p-6 sm:p-8">{children}</div>
}

function SectionTitle({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
    </div>
  )
}

function Detail({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--surface-subtle)] p-3">
      <p className="flex items-center gap-2 text-xs text-muted-foreground"><Icon className="h-3.5 w-3.5" />{label}</p>
      <p className="mt-1 text-sm font-medium">{value}</p>
    </div>
  )
}

function FieldInput({
  label,
  field,
  value,
  placeholder,
  type = "text",
  onFocus,
  onBlur,
  onChange,
  readOnly = false,
}: {
  label: string
  field: keyof CheckoutDraft
  value: string
  placeholder?: string
  type?: string
  onFocus: (field: string) => void
  onBlur: (field: string) => void
  onChange: <K extends keyof CheckoutDraft>(field: K, value: CheckoutDraft[K]) => void
  readOnly?: boolean
}) {
  return (
    <div>
      <label className="mb-1 block text-xs text-muted-foreground">{label}</label>
      <input
        type={type}
        data-testid={`checkout-${String(field)}`}
        className="h-10 w-full rounded-md border border-border/40 bg-background px-3 text-sm"
        value={value}
        readOnly={readOnly}
        onFocus={() => onFocus(String(field))}
        onBlur={() => onBlur(String(field))}
        onChange={(event) => onChange(field, event.target.value as any)}
        placeholder={placeholder}
      />
    </div>
  )
}

function QuantityStepper({
  label,
  value,
  onChange,
  onFocus,
  onBlur,
}: {
  label: string
  value: number
  onChange: (value: number) => void
  onFocus?: () => void
  onBlur?: () => void
}) {
  const set = (next: number) => onChange(Math.max(1, Math.min(100, Math.floor(Number(next) || 1))))
  return (
    <div>
      <label className="mb-1 block text-xs text-muted-foreground">{label}</label>
      <div className="flex h-11 items-center rounded-xl border border-[var(--border-primary)] bg-[rgba(255,255,255,0.035)] p-1 shadow-sm shadow-black/20 transition focus-within:border-[var(--accent-primary)] focus-within:ring-[3px] focus-within:ring-[rgba(20,184,166,0.12)]">
        <button
          type="button"
          className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-[rgba(255,255,255,0.08)] hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
          onClick={() => set(value - 1)}
          disabled={value <= 1}
          aria-label="Decrease quantity"
        >
          <Minus className="h-4 w-4" />
        </button>
        <input
          data-testid="checkout-quantity"
          inputMode="numeric"
          pattern="[0-9]*"
          value={String(value)}
          onFocus={onFocus}
          onBlur={onBlur}
          onChange={(event) => set(Number(event.target.value || 1))}
          className="h-9 min-w-0 flex-1 bg-transparent px-2 text-center font-mono text-base font-semibold text-foreground outline-none"
          aria-label="Quantity"
        />
        <button
          type="button"
          className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-[rgba(255,255,255,0.08)] hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
          onClick={() => set(value + 1)}
          disabled={value >= 100}
          aria-label="Increase quantity"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

function PreviewSecret({
  label,
  value,
  copyValue,
  copyKey,
  disabled,
  onCopy,
}: {
  label: string
  value: string
  copyValue?: string
  copyKey: string
  disabled?: boolean
  onCopy: (value: string, key: string, label?: string) => Promise<void>
}) {
  return (
    <div className="rounded-lg border border-border/40 bg-background/40 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="mt-1 flex items-center justify-between gap-2">
        <span className="min-w-0 truncate font-mono text-xs text-foreground">{value}</span>
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0" disabled={disabled} onClick={() => void onCopy(copyValue ?? value, copyKey, `${label.toLowerCase()} copied`)}>
          <Copy className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  )
}

function AddressInput({ label, value, onChange, required = true }: {
  label: string
  value: string
  onChange: (value: string) => void
  required?: boolean
}) {
  const testId = `billing-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`
  return (
    <label className="space-y-2 text-sm">
      <span className="text-muted-foreground">{label}{required ? "" : " (optional)"}</span>
      <input
        data-testid={testId}
        className="h-11 w-full rounded-lg border border-border/50 bg-background px-3 text-foreground outline-none transition focus:border-accent"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
      />
    </label>
  )
}

function SummaryRow({ k, v, tone = "default" }: { k: string; v: string; tone?: "default" | "success" }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{k}</span>
      <span className={`text-right font-medium ${tone === "success" ? "text-cyan-400" : "text-foreground"}`}>{v}</span>
    </div>
  )
}

function PriceRow({ label, value, highlight = false, suffix = "", formatMoney = formatPrice }: { label: string; value: number; highlight?: boolean; suffix?: string; formatMoney?: (value: number) => string }) {
  return (
    <div className="mt-1.5 flex items-center justify-between text-muted-foreground">
      <span>{label}</span>
      <span className={highlight ? "text-cyan-400" : ""}>{value < 0 ? `- ${formatMoney(Math.abs(value))}${suffix ? ` ${suffix}` : ""}` : `${formatMoney(value)}${suffix}`}</span>
    </div>
  )
}

function MonthlyPriceRow({ label, value, included = false, formatMoney = formatPrice }: { label: string; value: number; included?: boolean; formatMoney?: (value: number) => string }) {
  return (
    <div className="mt-1.5 flex items-center justify-between text-muted-foreground">
      <span>{label}</span>
      <span>{value > 0 ? `${formatMoney(value)}/mo` : included ? "Included" : `${formatMoney(0)}/mo`}</span>
    </div>
  )
}

function GatewayBrandMark({ gateway }: { gateway: CheckoutGatewayOption }) {
  if (gateway.code === "razorpay") {
    return (
      <Image
        src={gateway.logo || "/gateway-logos/razorpay-logo.svg"}
        alt="Razorpay"
        width={28}
        height={28}
        unoptimized
        className="h-7 w-7 shrink-0 rounded-md object-contain"
      />
    )
  }
  if (gateway.code === "cashfree") {
    return (
      <Image
        src={gateway.logo || "/gateway-logos/cashfree-logo.png"}
        alt="Cashfree"
        width={28}
        height={28}
        unoptimized
        className="h-7 w-7 shrink-0 rounded-md object-contain"
      />
    )
  }
  const styles: Record<CheckoutGatewayCode, { bg: string; fg: string; symbol: string }> = {
    phonepe: { bg: "#5F259F", fg: "#ffffff", symbol: "P" },
  } as Record<CheckoutGatewayCode, { bg: string; fg: string; symbol: string }>
  const brand = styles[gateway.code] || styles.phonepe
  return (
    <span
      aria-hidden="true"
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[10px] font-bold"
      style={{ backgroundColor: brand.bg, color: brand.fg }}
    >
      {brand.symbol}
    </span>
  )
}
