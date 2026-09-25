import { NextRequest, NextResponse } from "next/server"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { prisma } from "@/lib/db"
import { NO_CACHE_HEADERS } from "@/lib/http-cache"
import { ipPoolReadiness } from "@/lib/ip-pool"
import { validateProvisioningPreflight } from "@/lib/provisioning-placement"
import { getAdminFromCookies } from "@/lib/server-auth"

export const dynamic = "force-dynamic"
export const revalidate = 0

export async function GET(request: NextRequest, { params }: { params: Promise<{ orderId: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401, headers: NO_CACHE_HEADERS })
  }

  try {
    const { orderId } = await params
    const nodeSelection = String(request.nextUrl.searchParams.get("nodeId") || "product_default").trim()
    const ipAssignmentMode = String(request.nextUrl.searchParams.get("ipAssignmentMode") || "automatic").trim()
    const poolId = String(request.nextUrl.searchParams.get("poolId") || "").trim()
    const requestedIp = String(request.nextUrl.searchParams.get("requestedIp") || "").trim()
    const forceIpOverride = request.nextUrl.searchParams.get("forceIpOverride") === "true"
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { product: true, customConfig: true, offer: true, operatingSystem: true },
    })
    if (!order) return NextResponse.json({ success: false, error: "Order not found" }, { status: 404, headers: NO_CACHE_HEADERS })

    let nodeId: string | null = null
    if (nodeSelection && !["auto", "product_default"].includes(nodeSelection)) nodeId = nodeSelection
    else if (nodeSelection === "product_default") nodeId = order.product?.defaultNodeId || order.proxmoxNodeId || null
    const resolvedNode = nodeId ? await prisma.proxmoxNode.findUnique({ where: { id: nodeId }, select: { id: true, name: true, nodeName: true, status: true, isActive: true } }) : null

    const customDisks = Array.isArray(order.customConfig?.disks) ? order.customConfig!.disks as any[] : []
    const preflight = await validateProvisioningPreflight({
      nodeId,
      vcpu: Number(order.product?.cpuCores || order.customConfig?.cpuCores || 1),
      ramGb: Number(order.product?.ramGb || order.customConfig?.ramGb || 1),
      storageGb: Number(order.product?.storageGb || customDisks.reduce((sum, disk) => sum + Number(disk?.sizeGb || 0), 0) || 20),
      productId: order.productId,
      bandwidthTb: Number(order.product?.bandwidthTb || order.customConfig?.bandwidthTb || 0),
      osFamily: order.requestedOsFamily || order.operatingSystem?.osFamily || order.osName || null,
      osVersion: order.requestedOsVersion || order.operatingSystem?.osVersion || null,
      osTemplateId: order.operatingSystemId || null,
      nodeClassId: order.nodeClassId,
      storagePoolId: order.storagePoolId || order.offer?.storagePoolId || null,
      storagePolicyType: order.product?.storagePolicyType || order.product?.storagePoolPolicy || null,
      requiredStorageType: order.product?.requiredStorageType || order.product?.storageType || null,
      requiredStoragePoolId: order.product?.requiredStoragePoolId || order.product?.defaultStoragePoolId || null,
      allowStorageFallback: order.product?.allowStorageFallback,
      allowPremiumNewPurchase: Boolean(order.offerId),
      poolId: poolId || null,
      requestedIp: ipAssignmentMode === "manual" || requestedIp ? requestedIp || null : null,
      forceIpOverride,
    })

    const readinessNode = resolvedNode || (preflight.placement?.ok ? { id: preflight.placement.node.id, name: preflight.placement.node.name, nodeName: preflight.placement.node.nodeName, status: preflight.placement.node.status, isActive: preflight.placement.node.isActive } : null)
    const ipPools = readinessNode
      ? await ipPoolReadiness({
          proxmoxNodeId: readinessNode.id,
          productId: order.productId,
          allocationType: "default",
          poolId: poolId || null,
          requestedIp: ipAssignmentMode === "manual" || requestedIp ? requestedIp || null : null,
          forceOverride: forceIpOverride,
          availableLimit: 250,
        }).catch((error: any) => ({
          ok: false,
          errorCode: "IP_POOL_READINESS_FAILED",
          reason: error?.message || "Unable to inspect IP pools",
          selectedPool: null,
          fallbackPool: null,
          selectedIp: null,
          availableIps: [],
          pools: [],
          exhaustedPools: [],
        }))
      : {
          ok: false,
          errorCode: "NODE_NOT_RESOLVED",
          reason: "Select a node before checking IP pools",
          selectedPool: null,
          fallbackPool: null,
          selectedIp: null,
          availableIps: [],
          pools: [],
          exhaustedPools: [],
        }

    return NextResponse.json({
      success: true,
      nodeSelection,
      resolvedNode: readinessNode,
      preflight,
      ipAssignmentMode,
      ipPools: ipPools.pools,
      exhaustedPools: ipPools.exhaustedPools,
      availableIps: ipPools.availableIps,
      selectedPool: ipPools.selectedPool,
      fallbackPool: ipPools.fallbackPool,
      selectedIp: ipPools.selectedIp,
      ipReadiness: ipPools,
    }, { headers: NO_CACHE_HEADERS })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error?.message || "Unable to check readiness" }, { status: 400, headers: NO_CACHE_HEADERS })
  }
}
