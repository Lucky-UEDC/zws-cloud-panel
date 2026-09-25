import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { getAdminFromCookies } from "@/lib/server-auth"
import { apiError, apiSuccess } from "@/lib/api-response"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { calculateAdminOrderPreview, normalizeAdminProvisioningMode, normalizeAdminOrderTerm } from "@/lib/admin-order-preview"
import { offerAvailability } from "@/lib/offers"

export async function POST(request: NextRequest) {
  try {
    const admin = await getAdminFromCookies()
    if (!admin?.email || !canAccessAdminApi(admin.role)) {
      return apiError("unauthorized", "Unauthorized", 401)
    }

    const body = await request.json().catch(() => ({}))
    const productId = String(body.productId || "").trim()
    const offerId = String(body.offerId || "").trim()
    const operatingSystemId = String(body.operatingSystemId || "").trim()
    const nodeId = String(body.nodeId || body.proxmoxNodeId || "").trim()
    const termMonths = normalizeAdminOrderTerm(body.termMonths || body.term || 1)
    const provisioningMode = normalizeAdminProvisioningMode(body.provisioningMode || body.provisionMode)

    if (!productId && !offerId) return apiError("invalid_request", "Product or offer is required", 400)

    const [product, offer, operatingSystem, selectedNode] = await Promise.all([
      productId ? prisma.product.findUnique({ where: { id: productId } }) : null,
      offerId ? prisma.offer.findUnique({ where: { id: offerId } }) : null,
      operatingSystemId ? prisma.osTemplate.findUnique({ where: { id: operatingSystemId }, include: { proxmoxNode: true } }) : null,
      nodeId && !["auto", "product_default"].includes(nodeId)
        ? prisma.proxmoxNode.findFirst({ where: { id: nodeId, isActive: true }, select: { id: true, name: true, nodeName: true } })
        : null,
    ])

    if (!product && !offer) return apiError("product_missing", "Product or offer not found", 404)
    if (offer) {
      const availability = offerAvailability(offer)
      if (!availability.available) return apiError("offer_unavailable", availability.reason || "Offer is no longer available", 400)
      const allowedTerms = Array.isArray(offer.billingTermsAllowed) ? offer.billingTermsAllowed.map((item) => Number(item)) : [1]
      if (!allowedTerms.includes(termMonths)) return apiError("invalid_term", "This offer is not available for the selected billing term.", 400)
    }

    const external = {
      externalProvider: body.externalProvider,
      externalVmId: body.externalVmId,
      hostname: body.externalHostname || body.hostname,
      cpu: body.externalCpu || body.cpu,
      ramGb: body.externalRamGb || body.ramGb,
      diskGb: body.externalDiskGb || body.diskGb,
      bandwidthTb: body.externalBandwidthTb || body.bandwidthTb,
      operatingSystem: body.externalOperatingSystem || body.operatingSystem,
      location: body.externalLocation || body.location,
    }
    const manual = {
      provider: body.manualProvider || body.provider,
      hostname: body.manualHostname || body.hostname,
      cpu: body.manualCpu || body.cpu,
      ramGb: body.manualRamGb || body.ramGb,
      diskGb: body.manualDiskGb || body.diskGb,
      bandwidthTb: body.manualBandwidthTb || body.bandwidthTb,
      operatingSystem: body.manualOperatingSystem || body.operatingSystem,
      location: body.manualLocation || body.location,
    }

    const preview = calculateAdminOrderPreview({
      provisioningMode,
      termMonths,
      quantity: body.quantity,
      discountAmount: body.discountAmount,
      backupEnabled: body.backupEnabled,
      snapshotCount: body.snapshotCount,
      ipv4Count: body.ipv4Count,
      product,
      offer,
      operatingSystem,
      selectedNode,
      external,
      manual,
    })

    const validation = {
      canCreate: Boolean(product || offer),
      messages: [
        provisioningMode === "link_existing_vm" && Number(body.quantity || 1) !== 1 ? "Link Existing VM supports one VM per order" : null,
      ].filter(Boolean),
    }

    return apiSuccess({
      success: true,
      preview,
      pricing: preview.pricing,
      pricingSnapshot: preview.pricingSnapshot,
      resourceSummary: preview.resourceSummary,
      configSummary: preview.configSummary,
      validation: {
        ...validation,
        canCreate: validation.canCreate && validation.messages.length === 0,
      },
      canCreate: validation.canCreate && validation.messages.length === 0,
    })
  } catch (error: any) {
    console.error("[ADMIN_ORDER_PREVIEW]", error)
    return apiError("server_error", error?.message || "Unable to calculate order preview", 500)
  }
}
