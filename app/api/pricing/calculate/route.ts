import { NextRequest } from "next/server"
import { NextResponse } from "next/server"
import { BillingTerm, StorageType, formatPrice } from "@/lib/pricing"
import { getCustomConfigurationSettings } from "@/lib/settings"
import {
  calculateCustomConfigurationQuote,
  validateCustomConfigurationInput,
} from "@/lib/custom-configuration-pricing"
import { prisma } from "@/lib/db"
import type { CheckoutApiError, CheckoutApiSuccess } from "@/lib/checkout-shared"
import { getRegionalPrice, getUserCountry } from "@/lib/regional-pricing"

const ALLOWED_TERMS = new Set([1, 3, 6, 12, 24, 36])

function apiError(code: string, message: string, status = 400) {
  const body: CheckoutApiError = { ok: false, error: message, code }
  return NextResponse.json(body, { status })
}

function apiSuccess<T extends Record<string, unknown>>(data: T, status = 200) {
  const body: CheckoutApiSuccess<T> = { ok: true, data }
  return NextResponse.json(body, { status })
}

export async function POST(request: NextRequest) {
  try {
    const settings = await getCustomConfigurationSettings()
    if (!settings.enableCustomConfiguration) {
      return apiError("custom_config_disabled", "Custom configuration is disabled.", 403)
    }

    const body = await request.json().catch(() => ({}))
    const {
      cpuCores,
      ramGb,
      storageGb: legacyStorageGb,
      storageType = "nvme",
      disks,
      storagePoolId,
      bandwidthTb = 1,
      term = 1,
    } = body
    const parsedTerm = Number(term)
    if (!ALLOWED_TERMS.has(parsedTerm)) {
      return apiError("invalid_term", "Invalid billing term. Supported terms: 1, 3, 6, 12, 24, 36.", 400)
    }

    const normalizedDisks = Array.isArray(disks) ? disks : []
    const storageGb =
      normalizedDisks.length > 0
        ? normalizedDisks.reduce((sum, disk) => sum + Number(disk?.sizeGb || 0), 0)
        : legacyStorageGb
    const derivedStorageType =
      normalizedDisks.length > 0 ? (normalizedDisks[0]?.type || "nvme") : storageType
    const selectedStoragePool = storagePoolId ? await prisma.nodeStoragePoolConfig.findFirst({
      where: { id: String(storagePoolId), enabled: true, missingFromProxmox: false, isCustomerSelectable: true, isUpgradeOnly: false },
    }) : null
    if (storagePoolId && !selectedStoragePool) {
      return apiError("storage_pool_unavailable", "Selected storage pool is unavailable.", 400)
    }

    // Validate input types
    if (
      typeof cpuCores !== "number" ||
      typeof ramGb !== "number" ||
      typeof storageGb !== "number" ||
      typeof bandwidthTb !== "number"
    ) {
      return apiError("invalid_configuration", "Invalid input: all numeric values must be numbers", 400)
    }

    const config = {
      cpuCores,
      ramGb,
      storageGb,
      storageType: derivedStorageType as StorageType,
      bandwidthTb,
    }

    const pricingInput = {
      ...config,
      disks: normalizedDisks.length > 0 ? normalizedDisks : undefined,
      term: parsedTerm as BillingTerm,
    }

    const validation = validateCustomConfigurationInput(pricingInput, settings)
    if (!validation.valid) {
      return apiError("invalid_configuration", validation.errors.join(" "), 400)
    }

    const pricing = calculateCustomConfigurationQuote(pricingInput, settings)
    if (selectedStoragePool) {
      pricing.breakdown.storage = Number((Number(storageGb || 0) * Number(selectedStoragePool.pricePerGbMonthly || 0)).toFixed(2))
      pricing.baseMonthly = Number((pricing.breakdown.cpu + pricing.breakdown.ram + pricing.breakdown.storage + pricing.breakdown.bandwidth).toFixed(2))
      pricing.discountedMonthly = pricing.baseMonthly
      pricing.subtotal = Number((pricing.discountedMonthly * parsedTerm).toFixed(2))
      pricing.taxAmount = Number((pricing.subtotal * (pricing.taxRate / 100)).toFixed(2))
      pricing.grandTotal = Number((pricing.subtotal + pricing.taxAmount).toFixed(2))
    }

    const countryCode = await getUserCountry(request)
    const regional = await getRegionalPrice({
      amountInr: pricing.grandTotal,
      countryCode,
      term: parsedTerm,
      product: "custom-configuration",
      context: { source: "custom_pricing_calculate" },
    }).catch(() => null)
    const displayMoney = (value: number) => formatPrice(value)

    return apiSuccess({
      config: {
        cpuCores,
        ramGb,
        storageGb,
        storageType: derivedStorageType,
        storagePoolId: selectedStoragePool?.id || null,
        disks: normalizedDisks.length > 0 ? normalizedDisks : undefined,
        bandwidthTb,
        term: parsedTerm,
      },
      pricing: {
        baseMonthly: pricing.baseMonthly,
        discountedMonthly: pricing.discountedMonthly,
        hourly: Number((pricing.discountedMonthly / 730).toFixed(4)),
        termTotal: pricing.subtotal,
        savingsPercentage: pricing.discountPercent,
        breakdown: {
          cpu: pricing.breakdown.cpu,
          ram: pricing.breakdown.ram,
          storage: pricing.breakdown.storage,
          bandwidth: pricing.breakdown.bandwidth,
          bandwidthIncluded: 0,
        },
      },
      tax: {
        rate: pricing.taxRate,
        amount: pricing.taxAmount,
      },
      total: {
        subtotal: pricing.subtotal,
        tax: pricing.taxAmount,
        grandTotal: pricing.grandTotal,
        regional,
        formatted: {
          subtotal: displayMoney(pricing.subtotal),
          tax: displayMoney(pricing.taxAmount),
          grandTotal: regional?.formatted || displayMoney(pricing.grandTotal),
        },
      },
      limits: settings,
    })
  } catch (error) {
    console.error("Pricing calculation error:", error)
    return apiError("server_error", "Internal server error", 500)
  }
}
