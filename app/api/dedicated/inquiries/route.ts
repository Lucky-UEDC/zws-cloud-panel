import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getClientFromRequest } from "@/lib/server-auth"
import { apiError } from "@/lib/api-response"
import { getPublicSiteSettings } from "@/lib/settings/site-settings"
import { cleanWhatsappPhone } from "@/lib/dedicated"
import { getPublicProductsWhere } from "@/lib/public-products"
import { requireRateLimit, requireTurnstile, securityGate } from "@/lib/security/forms"
import { validateSecurityField } from "@/lib/security/input"
import { rejectDetectedPayload } from "@/lib/security/abuse"

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
}

function toInquiryNumber(): string {
  const ts = Date.now().toString(36).toUpperCase()
  const rnd = Math.random().toString(36).slice(2, 6).toUpperCase()
  return `DI-${ts}-${rnd}`
}

function formatWhatsAppMessage(input: {
  productName: string
  cpu: string
  cores: number
  ramGb: number
  storage: string
  uplink: string
  monthlyCost: string
  siteUrl: string
  brandName: string
}) {
  return [
    "I want config of dedicated server:",
    `Product: ${input.productName}`,
    `CPU: ${input.cpu}`,
    `Cores: ${input.cores}`,
    `RAM: ${input.ramGb} GB`,
    `Storage: ${input.storage}`,
    `Uplink: ${input.uplink}`,
    `Monthly cost: ${input.monthlyCost}`,
    "Intent: Dedicated booking inquiry",
    `Website: ${input.siteUrl}`,
    `by ${input.brandName}`,
  ].join("\n")
}

export async function POST(request: NextRequest) {
  const gate = await securityGate(request)
  if (!gate.ok) return gate.response

  try {
    const body = (await request.json().catch(() => ({}))) as {
      productId?: string
      sourcePath?: string
      intent?: string
      turnstileToken?: string
    }
    const captcha = await requireTurnstile(gate.ctx, body.turnstileToken, "contact")
    if (!captcha.ok) return captcha.response
    const rate = await requireRateLimit(gate.ctx, "dedicated_inquiry", 5, 60 * 60_000)
    if (!rate.ok) return rate.response

    const productResult = validateSecurityField(body.productId, "id", "Product")
    if (!productResult.ok) {
      if (productResult.detection.dangerous) return rejectDetectedPayload(gate.ctx, productResult.detection, "productId")
      return apiError("invalid_request", "Dedicated productId is required", 400)
    }
    const productId = productResult.value
    if (!productId) {
      return apiError("invalid_request", "Dedicated productId is required", 400)
    }

    const product = await prisma.product.findFirst({
      where: {
        ...getPublicProductsWhere(),
        id: productId,
        type: "dedicated",
      },
    })
    if (!product) {
      return apiError("invalid_request", "Dedicated product not found", 404)
    }

    const client = await getClientFromRequest(request)
    const customer = client?.sub
      ? await prisma.customer.findUnique({ where: { id: String(client.sub) } })
      : null

    const inquiryNumber = toInquiryNumber()
    const storageLabel = `${Number(product.storageGb)} GB ${String(product.storageType || "SSD").toUpperCase()}`
    const uplink = (product.features as string[] | null)?.find((feature) => /mbps|gbps|uplink/i.test(String(feature || ""))) || "512 Mbps"
    const cpuLabel = (product.features as string[] | null)?.find((feature) => /cpu:/i.test(String(feature || "")))?.replace(/cpu:\s*/i, "") || product.name
    const monthlyCost = `INR ${Number(product.price1m).toLocaleString("en-IN")}`
    const brand = await getPublicSiteSettings()
    const phone = cleanWhatsappPhone(brand.companyPhone)

    const message = formatWhatsAppMessage({
      productName: product.name,
      cpu: cpuLabel,
      cores: Number(product.cpuCores),
      ramGb: Number(product.ramGb),
      storage: storageLabel,
      uplink,
      monthlyCost,
      siteUrl: brand.siteUrl,
      brandName: brand.brandName,
    })

    const inquiry = await prisma.dedicatedInquiry.create({
      data: {
        inquiryNumber,
        productId: product.id,
        customerId: customer?.id || null,
        customerEmail: customer?.email || client?.email || null,
        customerName: customer?.name || client?.name || null,
        customerPhone: customer?.phone || null,
        intent: String(body.intent || "book_now"),
        sourcePath: String(body.sourcePath || "/dedicated"),
        sourceHost: new URL(brand.siteUrl).hostname,
        status: "new",
        productSnapshot: {
          id: product.id,
          slug: product.slug,
          name: product.name,
          cpu: cpuLabel,
          cores: Number(product.cpuCores),
          ramGb: Number(product.ramGb),
          storage: storageLabel,
          uplink,
          monthlyCost,
        },
      },
    })

    return NextResponse.json({
      success: true,
      inquiryId: inquiry.id,
      inquiryNumber: inquiry.inquiryNumber,
      whatsappUrl: phone ? `https://wa.me/${phone}?text=${encodeURIComponent(message)}` : null,
      message,
    }, { headers: NO_STORE_HEADERS })
  } catch (error) {
    console.error("[dedicated] inquiry creation failed", error)
    return apiError("server_error", "Unable to create dedicated inquiry right now.", 500)
  }
}
