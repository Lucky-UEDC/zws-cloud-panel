import { getPublicProducts } from "@/lib/public-products"
import { getPublicOperatingSystems } from "@/lib/public-operating-systems"
import { normalizeBillingTerm } from "@/lib/billing-pricing"
import { calculateCheckoutQuote } from "@/lib/checkout-shared"
import type { CheckoutBootstrap, CheckoutDraft, CheckoutGatewayCode, CheckoutGatewayOption, OperatingSystem, Product } from "@/app/checkout/CheckoutContent"
import { getUsableGateways, type UsableRuntimeGateway } from "@/lib/runtime-payment-resolver"
import { getClientFromCookies } from "@/lib/server-auth"
import { prisma } from "@/lib/db"

export type CheckoutSearchParams = {
  product?: string
  term?: string
  cycle?: string
  region?: string
  os?: string
  cpu?: string
  ram?: string
  storage?: string
  bandwidth?: string
  coupon?: string
  node?: string
  diskTier?: string
  storagePoolId?: string
  disk?: string
  cpuTier?: string
}

const INITIAL_SERVER_CHECKOUT_DRAFT: CheckoutDraft = {
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
  serverTag: "",
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

function numberFromQuery(value: string | undefined, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function firstRegion(product: Product | null | undefined) {
  const first = product?.regions?.[0]
  if (!first) return "India"
  return typeof first === "string" ? first : (first.name || first.slug || "India")
}

function selectedOperatingSystem(items: OperatingSystem[], requestedId?: string) {
  if (requestedId && items.some((os) => os.id === requestedId)) return items.find((os) => os.id === requestedId) || null
  return items.find((os) => os.recommended) || items[0] || null
}

function isCheckoutGatewayCode(value: unknown): value is CheckoutGatewayCode {
  return value === "razorpay" || value === "phonepe" || value === "cashfree"
}

function checkoutGatewayLabel(code: CheckoutGatewayCode) {
  if (code === "razorpay") return "Razorpay"
  if (code === "phonepe") return "PhonePe"
  return "Cashfree"
}

function safeGatewayLogo(gateway: UsableRuntimeGateway): string | null {
  const raw = String(gateway.credentialsPlain?.logo || gateway.credentials?.logo || "").trim()
  if (!raw) return null
  return /^(https:\/\/|data:image\/(png|jpeg|webp|svg\+xml);)/i.test(raw) && raw.length <= 4096 ? raw : null
}

/**
 * Server-side Account Credit balance for the logged-in client (if any).
 * Returns null when there is no authenticated client or the balance cannot
 * be resolved — the client UI then fetches it from /api/client/wallet.
 */
async function clientWalletBalance(): Promise<number | null> {
  try {
    const client = await getClientFromCookies()
    if (!client?.sub) return null
    const customer = await prisma.customer.findUnique({
      where: { id: String(client.sub) },
      select: { walletBalance: true },
    })
    const balance = Number(customer?.walletBalance || 0)
    return Number.isFinite(balance) && balance >= 0 ? balance : 0
  } catch (error) {
    console.error("[checkout_wallet_balance_failed]", error instanceof Error ? error.message : String(error))
    return null
  }
}

export function safeOperatingSystems(input: unknown): OperatingSystem[] {
  if (!Array.isArray(input)) return []
  return input
    .map((item: any) => {
      const id = String(item?.id || "").trim()
      if (!id) return null
      const name = String(item?.name || item?.familyLabel || item?.family || "Operating System").trim() || "Operating System"
      const family = String(item?.family || item?.osFamily || "linux").trim() || "linux"
      const familyLabel = String(item?.familyLabel || item?.osFamily || name).trim() || name
      const version = String(item?.version || item?.osVersion || item?.name || "Latest").trim() || "Latest"
      return {
        ...item,
        id,
        name,
        slug: String(item?.slug || id).trim() || id,
        osType: String(item?.osType || item?.category || family || "linux").trim() || "linux",
        category: String(item?.category || family || "linux").trim() || "linux",
        proxmoxVmid: Number(item?.proxmoxVmid || 0),
        proxmoxNodeId: String(item?.proxmoxNodeId || ""),
        family,
        familyLabel,
        familyDescription: String(item?.familyDescription || `${familyLabel} Image`).trim() || `${familyLabel} Image`,
        version,
        defaultUsername: String(item?.defaultUsername || (family === "windows" ? "Administrator" : "root")),
        recommended: Boolean(item?.recommended || item?.isRecommended || item?.isDefault),
        eolWarningText: item?.eolWarningText || null,
        iconUrl: item?.iconUrl || null,
        proxmoxTemplateName: item?.proxmoxTemplateName || null,
      } satisfies OperatingSystem
    })
    .filter(Boolean) as OperatingSystem[]
}

function emptyCheckoutBootstrap(params: CheckoutSearchParams, error?: CheckoutBootstrap["bootstrapError"]): CheckoutBootstrap {
  const termMonths = normalizeBillingTerm(params.term || params.cycle || 1)
  return {
    product: null,
    operatingSystems: [],
    savedKeys: [],
    initialDraft: {
      ...INITIAL_SERVER_CHECKOUT_DRAFT,
      productSlug: params.product || "",
      termMonths,
      region: params.region || "India",
      couponCode: params.coupon?.toUpperCase() || "",
      nodeId: params.node || "",
      diskTier: params.diskTier || params.disk || "nvme",
      storagePoolId: params.storagePoolId || "",
      cpuTier: params.cpuTier || "standard",
    },
    initialQuote: null,
    initialBillingDiscounts: { 1: 0, 3: 5, 6: 10, 12: 15, 24: 20, 36: 25 },
    availableGateways: [],
    defaultGateway: null,
    walletBalance: null,
    bootstrapError: error,
  }
}

export async function buildCheckoutBootstrap(params: CheckoutSearchParams, requestHeaders?: Headers): Promise<CheckoutBootstrap> {
  const requestedProduct = params.product || ""
  const termMonths = normalizeBillingTerm(params.term || params.cycle || 1)
  try {
    const products = requestedProduct === "custom"
      ? await getPublicProducts({ type: "configurable", term: termMonths })
      : requestedProduct
        ? await getPublicProducts({ slug: requestedProduct, term: termMonths })
        : await getPublicProducts({ type: "fixed_vps", term: termMonths })
    const product = (requestedProduct === "custom"
      ? products.find((entry) => entry.type === "configurable") || products[0] || null
      : products[0] || null) as Product | null
    const fallbackProduct = requestedProduct === "custom" && !product
      ? ({
          id: "custom",
          slug: "custom",
          name: "Custom Cloud Instance",
          type: "configurable",
          cpuCores: 2,
          ramGb: 4,
          storageGb: 80,
          storageType: "nvme",
          bandwidthTb: 2,
          regions: ["India"],
          specs: {},
          price1m: 0,
          billingTerms: [1, 3, 6, 12, 24, 36],
          pricingBreakdown: null,
        } satisfies Product)
      : null
    const supportedProduct = product || fallbackProduct
    const operatingSystems = safeOperatingSystems(await getPublicOperatingSystems())
    const availableGateways = await getUsableGateways({
      request: requestHeaders ? ({ headers: requestHeaders } as any) : null,
    }).then((gateways: UsableRuntimeGateway[]) => gateways
      .filter((gateway): gateway is UsableRuntimeGateway & { gateway: CheckoutGatewayCode } => isCheckoutGatewayCode(gateway.gateway))
      .map((gateway) => ({
        code: gateway.gateway,
        label: checkoutGatewayLabel(gateway.gateway),
        logo: gateway.gateway === "razorpay" ? safeGatewayLogo(gateway) : null,
      } satisfies CheckoutGatewayOption)))
      .catch(() => [])
    const defaultGateway = availableGateways[0]?.code || null
    const os = selectedOperatingSystem(operatingSystems, params.os)
    const initialDraft: CheckoutDraft = {
      ...INITIAL_SERVER_CHECKOUT_DRAFT,
      productId: supportedProduct?.id || "",
      productSlug: supportedProduct?.slug || requestedProduct,
      productType: supportedProduct?.type || "",
      termMonths,
      region: params.region || firstRegion(supportedProduct),
      osTemplateId: os?.id || "",
      osFamily: os?.family || "",
      osVersion: os?.version || os?.name || "",
      adminUser: os?.defaultUsername || "root",
      couponCode: params.coupon?.toUpperCase() || "",
      customCpu: numberFromQuery(params.cpu, Number(supportedProduct?.cpuCores || 2)),
      customRamGb: numberFromQuery(params.ram, Number(supportedProduct?.ramGb || 4)),
      customStorageGb: numberFromQuery(params.storage, Number(supportedProduct?.storageGb || 80)),
      customBandwidthTb: numberFromQuery(params.bandwidth, Number(supportedProduct?.bandwidthTb || 2)),
      nodeId: params.node || "",
      diskTier: params.diskTier || params.disk || String(supportedProduct?.storageType || "nvme"),
      storagePoolId: params.storagePoolId || "",
      cpuTier: params.cpuTier || "standard",
      savedSshKeyId: null,
    }

    let initialQuote: CheckoutBootstrap["initialQuote"] = null
    let initialBillingDiscounts: Record<number, number> = { 1: 0, 3: 5, 6: 10, 12: 15, 24: 20, 36: 25 }
    let bootstrapError: CheckoutBootstrap["bootstrapError"] = supportedProduct ? null : {
      code: "product_unavailable",
      message: "Selected cloud instance is unavailable.",
      productSlug: requestedProduct || null,
      nodeId: params.node || null,
      templateId: params.os || null,
    }

    if (supportedProduct?.id || supportedProduct?.slug) {
      try {
        const quoteResult = await calculateCheckoutQuote({
          request: requestHeaders ? ({ headers: requestHeaders } as any) : undefined,
          productId: supportedProduct.id,
          productSlug: supportedProduct.slug,
          term: initialDraft.termMonths,
          region: initialDraft.region,
          osTemplateId: initialDraft.osTemplateId,
          customCpu: initialDraft.customCpu,
          customRamGb: initialDraft.customRamGb,
          customStorageGb: initialDraft.customStorageGb,
          customBandwidthTb: initialDraft.customBandwidthTb,
          diskTier: initialDraft.diskTier,
          storagePoolId: initialDraft.storagePoolId,
          cpuTier: initialDraft.cpuTier,
          nodeId: initialDraft.nodeId,
        })
        initialQuote = quoteResult.quote
        initialBillingDiscounts = quoteResult.billingDiscounts
      } catch (error) {
        const source = error as Error & { code?: string }
        bootstrapError = {
          code: source?.code || "initial_quote_failed",
          message: source?.message || "Initial quote could not be calculated.",
          productSlug: supportedProduct.slug || requestedProduct || null,
          productId: supportedProduct.id || null,
          nodeId: params.node || null,
          templateId: initialDraft.osTemplateId || params.os || null,
        }
      }
    }

    if (bootstrapError) {
      console.error("[checkout_bootstrap_failed]", {
        ...bootstrapError,
        requestedOs: params.os || null,
        selectedTemplateId: initialDraft.osTemplateId || null,
        selectedOsFamily: initialDraft.osFamily || null,
        selectedOsVersion: initialDraft.osVersion || null,
        osTemplateCount: operatingSystems.length,
      })
    }

    return {
      product: supportedProduct,
      operatingSystems,
      savedKeys: [],
      initialDraft,
      initialQuote,
      initialBillingDiscounts,
      availableGateways,
      defaultGateway,
      walletBalance: await clientWalletBalance(),
      bootstrapError,
    }
  } catch (error) {
    const source = error as Error & { code?: string }
    const bootstrapError = {
      code: source?.code || "checkout_bootstrap_failed",
      message: source?.message || "Checkout could not be prepared.",
      productSlug: requestedProduct || null,
      nodeId: params.node || null,
      templateId: params.os || null,
    }
    console.error("[checkout_bootstrap_failed]", {
      ...bootstrapError,
      requestedOs: params.os || null,
      selectedTemplateId: null,
      osTemplateCount: 0,
      stack: source?.stack || null,
    })
    return emptyCheckoutBootstrap(params, bootstrapError)
  }
}
