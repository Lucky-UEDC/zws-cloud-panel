import { prisma } from "@/lib/db"
import { createAuditLog } from "@/lib/audit-log"
import { ipPoolNodeEligibility, reserveIpFromPool } from "@/lib/ip-pool"
import { withRedisLock } from "@/lib/redis"
import { sendNotification } from "@/lib/notifications/service"
import { WHATSAPP_TEMPLATE_KEYS } from "@/lib/whatsapp/template-registry"

const WORKER_ACTION_BY_TYPE: Record<string, string> = {
  bandwidth: "apply_bandwidth_quota",
  ip: "attach_purchased_ip",
  snapshot: "apply_snapshot_quota",
  backup: "apply_backup_schedule",
  disk: "resize_disk",
  ram: "resize_memory",
  cpu: "resize_cpu",
}

const PENDING_PURCHASE_STATUSES = ["pending", "pending_payment"]
const ACTIVATABLE_PURCHASE_STATUSES = ["pending", "pending_payment", "payment_received"]
const FREE_ALLOCATION_STATUSES = ["free", "FREE", "released", "RELEASED"]
const RESERVATION_MINUTES = 60

function numberValue(value: unknown) {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function taxAmount(amount: number, taxPercent: number) {
  return Number(((amount * taxPercent) / 100).toFixed(2))
}

function addDays(date: Date, days: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function addMinutes(date: Date, minutes: number) {
  const next = new Date(date)
  next.setMinutes(next.getMinutes() + minutes)
  return next
}

function jsonRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {}
}

function jsonArray(value: unknown): any[] {
  return Array.isArray(value) ? value : []
}

function invoiceNumber() {
  return `ADDON-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`
}

function cleanKey(value: unknown) {
  return String(value || "").trim().slice(0, 160)
}

function normalizeMoney(value: unknown) {
  return Number(Number(value || 0).toFixed(2))
}

function formatInr(value: unknown) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(normalizeMoney(value))
}

function formatDate(value: unknown) {
  if (!value) return ""
  const date = value instanceof Date ? value : new Date(String(value))
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
}

function addonTemplateKey(addonType: string) {
  if (addonType === "ip") return WHATSAPP_TEMPLATE_KEYS.ADDITIONAL_IP_ACTIVATED
  if (addonType === "bandwidth") return WHATSAPP_TEMPLATE_KEYS.BANDWIDTH_ADDON_ACTIVATED
  if (addonType === "snapshot") return WHATSAPP_TEMPLATE_KEYS.SNAPSHOT_ADDON_ACTIVATED
  if (addonType === "backup") return WHATSAPP_TEMPLATE_KEYS.BACKUP_ADDON_ACTIVATED
  return null
}

function maskedIpLabel(ipAddress: unknown) {
  const parts = String(ipAddress || "").trim().split(".")
  if (parts.length !== 4) return "IPv4 Pool"
  return `${parts[0]}.${parts[1]}.x.x`
}

function friendlyPoolName(pool: any) {
  const explicit = String(pool?.displayName || pool?.metadata?.displayName || pool?.metadata?.publicName || "").trim()
  if (explicit) return explicit
  const raw = String(pool?.name || "").trim()
  if (raw && !/^\d{1,3}(?:\.\d{1,3}){1,3}(?:\s*pool)?$/i.test(raw)) return raw
  const start = String(pool?.startIp || "").trim()
  if (start.startsWith("151.243.")) return "India DC-1"
  if (start.startsWith("162.141.")) return "India DC-2"
  if (start.startsWith("103.207.")) return "India DC-3"
  return raw || "IPv4 Pool"
}

function poolEligibleForVm(pool: any, vps: any) {
  const nodeId = String(vps?.proxmoxNodeId || "")
  const region = String(vps?.serviceLocation || vps?.proxmoxNode?.location || "").trim()
  const eligibility = ipPoolNodeEligibility({ pool, nodeId, purpose: "addon" })
  const regionOk = !pool?.region || !region || String(pool.region).trim() === region
  const poolTypeOk = ["NORMAL", "ADDON_ONLY"].includes(String(pool?.poolType || "NORMAL").toUpperCase())
  return Boolean(eligibility.ok && regionOk && poolTypeOk)
}

function buildPoolOption(plan: any, poolPrice: any, pool: any, vps: any) {
  const price = normalizeMoney(poolPrice?.price ?? pool?.pricePerIp ?? plan?.basePrice)
  const taxPercent = numberValue(poolPrice?.taxPercent ?? plan?.taxPercent)
  const tax = taxAmount(price, taxPercent)
  const availableIpCount = Array.isArray(pool?.allocations)
    ? pool.allocations.filter((allocation: any) => FREE_ALLOCATION_STATUSES.includes(String(allocation.status))).length
    : 0
  const eligible = poolEligibleForVm(pool, vps)
  const healthy = !["down", "failed", "exhausted", "unhealthy"].includes(String(pool?.healthStatus || "").toLowerCase())
  return {
    poolId: pool.id,
    poolName: friendlyPoolName(pool),
    rawPoolName: pool.name,
    rangeLabel: maskedIpLabel(pool.startIp),
    subnet: maskedIpLabel(pool.startIp),
    startIp: maskedIpLabel(pool.startIp),
    endIp: maskedIpLabel(pool.endIp),
    gateway: pool.gateway || null,
    cidr: pool.cidr || null,
    dns: pool.dns || null,
    bridge: pool.bridgeOverride || pool.bridge || null,
    region: pool.region || pool.regionTag || null,
    healthStatus: pool.healthStatus || "unknown",
    availableIpCount,
    price,
    taxPercent,
    taxAmount: tax,
    total: normalizeMoney(price + tax),
    currency: poolPrice?.currency || plan?.currency || "INR",
    nodeEligible: eligible,
    available: Boolean(poolPrice?.available !== false && eligible && healthy && availableIpCount > 0),
  }
}

async function returnExistingPurchase(purchase: any, plan: any, reusedReason: string) {
  return returnExistingPurchaseWithInvoice(prisma, purchase, plan, reusedReason)
}

async function returnExistingPurchaseWithInvoice(db: any, purchase: any, plan: any, reusedReason: string) {
  const invoice = purchase?.invoiceId
    ? await db.invoice.findUnique({ where: { id: purchase.invoiceId } }).catch(() => null)
    : null
  if (!invoice) return null
  return {
    purchase,
    invoice,
    plan,
    total: Number(invoice.totalAmount || 0),
    reusedExisting: true,
    reusedReason,
  }
}

async function acquireAddonPurchaseDbLock(tx: any, scope: string) {
  if (!scope || typeof tx?.$executeRaw !== "function") return
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${scope}))`
}

export async function listAvailableVmAddons(input: { vpsId: string; customerId?: string | null }) {
  const vps = await prisma.vpsInstance.findFirst({
    where: {
      OR: [{ id: input.vpsId }, { orderId: input.vpsId }],
      ...(input.customerId ? { customerId: input.customerId } : {}),
      deletedAt: null,
      status: { not: "DELETED" },
    },
    include: {
      customer: { select: { id: true, email: true, name: true } },
      product: { select: { id: true, name: true } },
      proxmoxNode: { select: { id: true, name: true, nodeName: true, location: true } },
      vmIpAssignments: {
        where: { status: { in: ["active", "assigned", "used", "reserved"] as any } },
        include: { pool: true },
        orderBy: [{ isPrimary: "desc" }, { createdAt: "desc" }],
      },
    },
  })
  if (!vps) return null

  const canonicalAssignments = await (prisma as any).ipAssignment.findMany({
    where: { vpsInstanceId: vps.id, status: { in: ["active", "assigned", "reserved"] } },
    orderBy: [{ isPrimary: "desc" }, { assignmentDate: "desc" }],
  }).catch(() => [])
  const primaryPoolId = canonicalAssignments.find((item: any) => item.isPrimary)?.poolId ||
    canonicalAssignments[0]?.poolId ||
    vps.vmIpAssignments.find((item: any) => item.isPrimary)?.poolId ||
    vps.vmIpAssignments[0]?.poolId ||
    null
  const plans = await (prisma as any).vmAddonPlan.findMany({
    where: { active: true },
    orderBy: [{ addonType: "asc" }, { quantity: "asc" }, { name: "asc" }],
  }).catch(() => [])
  const nodePrices = vps.proxmoxNodeId
    ? await (prisma as any).vmAddonNodePrice.findMany({ where: { proxmoxNodeId: vps.proxmoxNodeId, active: true } }).catch(() => [])
    : []
  const poolPrices = await (prisma as any).vmAddonPoolPrice.findMany({ where: { available: true } }).catch(() => [])
  const activeAddons = await (prisma as any).vmAddon.findMany({
    where: { vpsInstanceId: vps.id, status: { in: ["active", "queued", "pending"] } },
    orderBy: { activatedAt: "desc" },
  }).catch(() => [])
  const pricedPoolIds = Array.from(new Set(poolPrices.map((row: any) => row.poolId).filter(Boolean)))
  const pricedPools = pricedPoolIds.length
    ? await (prisma as any).ipPool.findMany({
      where: { id: { in: pricedPoolIds }, isActive: true },
      include: {
        allocations: { select: { id: true, ipAddress: true, status: true } },
        poolNodeAssignments: { select: { nodeId: true, active: true, priority: true } },
        poolProductAssignments: { select: { productId: true, active: true, priority: true } },
      },
      orderBy: [{ allocationPriority: "asc" }, { name: "asc" }],
    }).catch(() => [])
    : []

  return {
    vps,
    primaryPoolId,
    activeAddons: activeAddons.map((addon: any) => ({
      id: addon.id,
      addonType: addon.addonType,
      addonPlanId: addon.addonPlanId || null,
      status: addon.status,
      quota: addon.quota === null || addon.quota === undefined ? null : Number(addon.quota),
      unit: addon.unit || null,
      activatedAt: addon.activatedAt || null,
      expiresAt: addon.expiresAt || null,
      removable: String(addon.addonType) !== "ip",
      permanent: String(addon.addonType) === "ip",
      metadata: addon.metadata || {},
    })),
    plans: plans
      .map((plan: any) => {
        const nodePrice = nodePrices.find((row: any) => row.addonPlanId === plan.id)
        const matchingPoolPrices = poolPrices.filter((row: any) => row.addonPlanId === plan.id)
        const poolOptions = plan.addonType === "ip"
          ? matchingPoolPrices
            .map((poolPrice: any) => {
              const pool = pricedPools.find((item: any) => item.id === poolPrice.poolId)
              return pool ? buildPoolOption(plan, poolPrice, pool, vps) : null
            })
            .filter((option: any) => option?.available)
            .sort((a: any, b: any) => Number(b.available) - Number(a.available) || a.total - b.total || String(a.poolName).localeCompare(String(b.poolName)))
          : []
        if (plan.addonType === "ip" && !poolOptions.length) return null
        const primaryPoolPrice = poolOptions.find((row: any) => row.poolId === primaryPoolId)
        const poolPrice = primaryPoolPrice || poolOptions[0]
        if (["bandwidth", "disk"].includes(plan.addonType) && vps.proxmoxNodeId && !nodePrice && Number(plan.basePrice || 0) <= 0) return null
        const selected = poolPrice || nodePrice || plan
        const amount = numberValue(selected.price ?? selected.basePrice)
        const taxPercent = numberValue(selected.taxPercent)
        const firstAvailablePool = poolOptions.find((option: any) => option.available) || poolOptions[0] || null
        const effectiveAmount = plan.addonType === "ip" && firstAvailablePool ? firstAvailablePool.price : amount
        const effectiveTaxPercent = plan.addonType === "ip" && firstAvailablePool ? firstAvailablePool.taxPercent : taxPercent
        const effectiveTax = taxAmount(effectiveAmount, effectiveTaxPercent)
        return {
          id: plan.id,
          addonType: plan.addonType,
          name: plan.name,
          slug: plan.slug,
          unit: plan.unit,
          quantity: plan.quantity === null || plan.quantity === undefined ? null : Number(plan.quantity),
          currency: firstAvailablePool?.currency || selected.currency || plan.currency || "INR",
          price: effectiveAmount,
          taxPercent: effectiveTaxPercent,
          taxAmount: effectiveTax,
          total: Number((effectiveAmount + effectiveTax).toFixed(2)),
          scope: poolPrice ? "pool" : nodePrice ? "node" : "global",
          poolId: firstAvailablePool?.poolId || poolPrice?.poolId || null,
          poolOptions,
          proxmoxNodeId: nodePrice?.proxmoxNodeId || null,
          recurring: plan.recurring,
          removable: plan.addonType !== "ip",
          permanent: plan.addonType === "ip",
        }
      })
      .filter(Boolean),
  }
}

export async function createPaidVmAddonPurchase(input: {
  vpsId: string
  customerId?: string | null
  addonPlanId: string
  actorEmail?: string | null
  orderId?: string | null
  invoiceId?: string | null
  paymentId?: string | null
  paymentVerified?: boolean
  metadata?: Record<string, unknown>
}) {
  throw new Error("Addon payment must be verified by invoice finalization. Direct addon activation is disabled.")
}

export async function createVmAddonPurchaseInvoice(input: {
  vpsId: string
  customerId?: string | null
  addonPlanId: string
  idempotencyKey: string
  poolId?: string | null
  actorEmail?: string | null
  metadata?: Record<string, unknown>
}) {
  const idempotencyKey = cleanKey(input.idempotencyKey)
  if (!idempotencyKey) throw new Error("idempotencyKey is required")
  const listing = await listAvailableVmAddons({ vpsId: input.vpsId, customerId: input.customerId || null })
  if (!listing?.vps) throw new Error("VM not found")
  const selected = listing.plans.find((plan: any) => plan.id === input.addonPlanId)
  if (!selected) throw new Error("Addon is not available for this VM")
  const selectedPool = selected.addonType === "ip"
    ? selected.poolOptions?.find((pool: any) => pool.poolId === String(input.poolId || ""))
    : null
  if (selected.addonType === "ip" && !input.poolId) throw new Error("Select an IP pool before buying this addon")
  if (selected.addonType === "ip" && !selectedPool) throw new Error("Selected IP pool is not available for this VM")
  if (selected.addonType === "ip" && !selectedPool.available) throw new Error("Selected IP pool is sold out or inactive")
  const quantity = selected.quantity || 1
  const vps = listing.vps
  const priced = selectedPool || selected
  const total = Number((priced.price + priced.taxAmount).toFixed(2))
  const now = new Date()
  const existingByKey = await (prisma as any).vmAddonPurchase.findUnique({ where: { idempotencyKey } }).catch(() => null)
  if (existingByKey) {
    const existing = await returnExistingPurchase(existingByKey, selected, "idempotency_key")
    if (existing) return existing
    throw new Error("Existing addon purchase is missing its invoice")
  }
  const selectedPoolKey = selectedPool?.poolId || null
  const existingPending = await (prisma as any).vmAddonPurchase.findFirst({
    where: {
      customerId: vps.customerId,
      vpsInstanceId: vps.id,
      addonPlanId: selected.id,
      poolId: selectedPoolKey,
      status: { in: PENDING_PURCHASE_STATUSES },
    },
    orderBy: { createdAt: "desc" },
  }).catch(() => null)
  if (existingPending) {
    const existing = await returnExistingPurchase(existingPending, selected, "pending_purchase")
    if (existing) return existing
  }
  const reservationExpiresAt = selected.addonType === "ip" ? addMinutes(now, RESERVATION_MINUTES) : null

  const lockScope = `addon-purchase:${vps.customerId}:${vps.id}:${selected.id}:${selectedPoolKey || "none"}`
  const result = await withRedisLock(`lock:${lockScope}`, 15_000, async () => prisma.$transaction(async (tx) => {
    await acquireAddonPurchaseDbLock(tx as any, lockScope)
    const concurrentByKey = await (tx as any).vmAddonPurchase.findUnique({ where: { idempotencyKey } }).catch(() => null)
    if (concurrentByKey) {
      const existing = await returnExistingPurchaseWithInvoice(tx as any, concurrentByKey, selected, "idempotency_key")
      if (existing) return existing
      throw new Error("Existing addon purchase is missing its invoice")
    }
    const concurrentPending = await (tx as any).vmAddonPurchase.findFirst({
      where: {
        customerId: vps.customerId,
        vpsInstanceId: vps.id,
        addonPlanId: selected.id,
        poolId: selectedPoolKey,
        status: { in: PENDING_PURCHASE_STATUSES },
      },
      orderBy: { createdAt: "desc" },
    }).catch(() => null)
    if (concurrentPending) {
      const existing = await returnExistingPurchaseWithInvoice(tx as any, concurrentPending, selected, "pending_purchase")
      if (existing) return existing
    }

    let reserved: any = null
    if (selected.addonType === "ip") {
      reserved = await reserveIpFromPool({
        poolId: String(input.poolId),
        proxmoxNodeId: vps.proxmoxNodeId || undefined,
        productId: vps.productId || undefined,
        region: vps.serviceLocation || vps.proxmoxNode?.location || undefined,
        vpsInstanceId: vps.id,
        vmid: vps.vmid || undefined,
        hostname: vps.name || undefined,
        assignedBy: input.actorEmail || "system:addon-invoice",
        purpose: "addon",
        forceOverride: false,
      }, tx as any)
    }
    const purchase = await (tx as any).vmAddonPurchase.create({
      data: {
        addonPlanId: selected.id,
        addonType: selected.addonType,
        vpsInstanceId: vps.id,
        customerId: vps.customerId,
        idempotencyKey,
        orderId: vps.orderId || null,
        invoiceId: null,
        paymentId: null,
        proxmoxNodeId: vps.proxmoxNodeId || null,
        poolId: selectedPool?.poolId || selected.poolId || listing.primaryPoolId || null,
        status: "pending_payment",
        quantity,
        unit: selected.unit || null,
        amount: priced.price,
        taxAmount: priced.taxAmount,
        currency: priced.currency || selected.currency || "INR",
        effectiveAt: null,
        expiresAt: reservationExpiresAt,
        metadata: {
          ...(input.metadata || {}),
          scope: selected.scope,
          invoicePending: true,
          idempotencyKey,
          poolId: selectedPool?.poolId || null,
          reservation: reserved ? {
            allocationId: reserved.id,
            ipAddress: reserved.ipAddress,
            poolId: reserved.poolId,
            expiresAt: reservationExpiresAt?.toISOString() || null,
          } : null,
        },
      },
    })
    const invoice = await tx.invoice.create({
      data: {
        invoiceNumber: invoiceNumber(),
        customerId: vps.customerId,
        orderId: null,
        issueDate: now,
        dueDate: addDays(now, 1),
        subtotal: priced.price,
        taxRate: priced.taxPercent,
        taxAmount: priced.taxAmount,
        gstPercent: priced.taxPercent,
        gstAmount: priced.taxAmount,
        taxLabel: "GST",
        totalAmount: total,
        currency: priced.currency || selected.currency || "INR",
        status: "sent",
        type: "addon",
        lineItems: [{
          type: "vm_addon",
          addonPlanId: selected.id,
          addonType: selected.addonType,
          name: selected.name,
          description: `${selected.name} for ${vps.name}`,
          quantity,
          unit: selected.unit || null,
          unitPrice: priced.price,
          taxPercent: priced.taxPercent,
          taxAmount: priced.taxAmount,
          total,
          vpsInstanceId: vps.id,
          vmid: vps.vmid || null,
          poolId: selectedPool?.poolId || null,
          reservedIp: reserved?.ipAddress || null,
        }],
        metadata: {
          invoiceType: "addon_purchase",
          paymentPurpose: "addon_purchase",
          addonPurchaseId: purchase.id,
          idempotencyKey,
          addonPlanId: selected.id,
          addonType: selected.addonType,
          vpsInstanceId: vps.id,
          vmid: vps.vmid || null,
          hostname: vps.name,
          scope: selected.scope,
          poolId: selectedPool?.poolId || selected.poolId || listing.primaryPoolId || null,
          reservation: reserved ? {
            allocationId: reserved.id,
            ipAddress: reserved.ipAddress,
            poolId: reserved.poolId,
            expiresAt: reservationExpiresAt?.toISOString() || null,
          } : null,
          proxmoxNodeId: vps.proxmoxNodeId || null,
        },
      },
    })
    const updatedPurchase = await (tx as any).vmAddonPurchase.update({
      where: { id: purchase.id },
      data: { invoiceId: invoice.id },
    })
    return { purchase: updatedPurchase, invoice }
  }))

  if (!(result as any).reusedExisting) {
    await createAuditLog({
      action: `${String(selected.addonType).toUpperCase()}_ADDON_INVOICE_CREATED`,
      actorEmail: input.actorEmail || "system:addon-invoice",
      customerId: vps.customerId,
      targetType: "vps_instance",
      targetId: vps.id,
      newValue: {
        purchaseId: result.purchase.id,
        invoiceId: result.invoice.id,
        addonPlanId: selected.id,
        addonType: selected.addonType,
        quantity,
        total,
        idempotencyKey,
        poolId: selectedPool?.poolId || null,
      },
      metadata: { source: "client_addon_api" },
    }).catch(() => null)
  }

  return { ...result, plan: selected, total }
}

export async function activatePaidVmAddonPurchase(input: {
  purchaseId?: string | null
  invoiceId?: string | null
  paymentId?: string | null
  actor?: string | null
}) {
  const purchase = await (prisma as any).vmAddonPurchase.findFirst({
    where: {
      ...(input.purchaseId ? { id: input.purchaseId } : {}),
      ...(input.invoiceId ? { invoiceId: input.invoiceId } : {}),
    },
  })
  if (!purchase) return { finalized: false, reason: "addon_purchase_not_found" }
  const [vps, addonPlan] = await Promise.all([
    prisma.vpsInstance.findUnique({ where: { id: purchase.vpsInstanceId }, include: { customer: true, proxmoxNode: true } }),
    (prisma as any).vmAddonPlan.findUnique({ where: { id: purchase.addonPlanId } }).catch(() => null),
  ])
  if (!vps) return { finalized: false, reason: "addon_vm_not_found" }
  if (!ACTIVATABLE_PURCHASE_STATUSES.includes(String(purchase.status || "").toLowerCase())) {
    const [entitlement, workerTask] = await Promise.all([
      (prisma as any).vmAddon.findFirst({ where: { purchaseId: purchase.id } }).catch(() => null),
      (prisma as any).vmAddonWorkerTask.findFirst({ where: { purchaseId: purchase.id }, orderBy: { createdAt: "desc" } }).catch(() => null),
    ])
    return {
      finalized: true,
      reason: "addon_purchase_already_finalized",
      purchaseId: purchase.id,
      entitlementId: entitlement?.id || null,
      workerTaskId: workerTask?.id || null,
    }
  }
  const invoice = purchase.invoiceId
    ? await prisma.invoice.findUnique({ where: { id: purchase.invoiceId }, include: { payments: { orderBy: { createdAt: "desc" } } } })
    : null
  if (invoice && !["paid", "completed"].includes(String(invoice.status || "").toLowerCase())) {
    return { finalized: false, reason: "addon_invoice_not_paid" }
  }

  const quantity = Number(purchase.quantity || addonPlan?.quantity || 1)
  const action = WORKER_ACTION_BY_TYPE[purchase.addonType] || "apply_addon"
  const completedImmediately = ["bandwidth", "snapshot", "backup"].includes(String(purchase.addonType))
  const permanentRecurringIp = String(purchase.addonType) === "ip"
  const result = await prisma.$transaction(async (tx) => {
    const claimed = await (tx as any).vmAddonPurchase.updateMany({
      where: { id: purchase.id, status: { in: ACTIVATABLE_PURCHASE_STATUSES } },
      data: {
        status: "active",
        paymentId: input.paymentId || purchase.paymentId || invoice?.payments?.[0]?.id || null,
        effectiveAt: purchase.effectiveAt || new Date(),
        metadata: {
          ...jsonRecord(purchase.metadata),
          activatedBy: input.actor || "invoice_paid",
          activatedFromInvoiceId: input.invoiceId || purchase.invoiceId || null,
        },
      },
    })
    if (!claimed.count) {
      const [entitlement, workerTask] = await Promise.all([
        (tx as any).vmAddon.findFirst({ where: { purchaseId: purchase.id } }),
        (tx as any).vmAddonWorkerTask.findFirst({ where: { purchaseId: purchase.id }, orderBy: { createdAt: "desc" } }),
      ])
      return { purchase, entitlement, workerTask, alreadyFinalized: true }
    }
    const updatedPurchase = await (tx as any).vmAddonPurchase.findUnique({ where: { id: purchase.id } })
    const entitlement = await (tx as any).vmAddon.findFirst({ where: { purchaseId: purchase.id } }) || await (tx as any).vmAddon.create({
      data: {
        vpsInstanceId: purchase.vpsInstanceId,
        customerId: purchase.customerId,
        purchaseId: purchase.id,
        addonPlanId: purchase.addonPlanId,
        addonType: purchase.addonType,
        status: "active",
        quota: quantity,
        unit: purchase.unit || addonPlan?.unit || null,
        used: 0,
        expiresAt: permanentRecurringIp ? (vps.renewalDueAt || vps.nextRenewalAt || null) : null,
        metadata: {
          planName: addonPlan?.name || null,
          paymentId: input.paymentId || purchase.paymentId || null,
          amount: Number(purchase.amount || 0),
          monthlyCost: Number(purchase.amount || 0),
          recurring: permanentRecurringIp || Boolean(addonPlan?.recurring),
          permanent: permanentRecurringIp,
          removable: !permanentRecurringIp,
        },
      },
    })
    const workerTask = await (tx as any).vmAddonWorkerTask.findFirst({ where: { purchaseId: purchase.id, action } }) || await (tx as any).vmAddonWorkerTask.create({
      data: {
        purchaseId: purchase.id,
        addonType: purchase.addonType,
        vpsInstanceId: purchase.vpsInstanceId,
        proxmoxNodeId: purchase.proxmoxNodeId || vps.proxmoxNodeId || null,
        vmid: vps.vmid || null,
        action,
        status: completedImmediately ? "completed" : "queued",
        completedAt: completedImmediately ? new Date() : null,
        payload: {
          addonPlanId: purchase.addonPlanId,
          quantity,
          unit: purchase.unit || addonPlan?.unit || null,
          poolId: purchase.poolId || null,
          amount: Number(purchase.amount || 0),
          taxAmount: Number(purchase.taxAmount || 0),
          reservation: jsonRecord(purchase.metadata).reservation || null,
          idempotencyKey: purchase.idempotencyKey || null,
        },
      },
    })
    return { purchase: updatedPurchase, entitlement, workerTask }
  })

  if ((result as any).alreadyFinalized) {
    return {
      finalized: true,
      reason: "addon_purchase_already_finalized",
      purchaseId: purchase.id,
      entitlementId: result.entitlement?.id || null,
      workerTaskId: result.workerTask?.id || null,
    }
  }

  let appliedIpResult: any = null
  if (String(purchase.addonType) === "ip" && result.workerTask?.id) {
    appliedIpResult = await applyVmAddonWorkerTask({ taskId: result.workerTask.id, actor: input.actor || "invoice_paid" }).catch(async (error) => {
      await (prisma as any).vmAddonWorkerTask.update({
        where: { id: result.workerTask.id },
        data: { status: "failed", attempts: { increment: 1 }, error: error?.message || "Unable to attach purchased IP" },
      }).catch(() => null)
      return null
    })
    if (appliedIpResult?.ipAddress && result.entitlement?.id) {
      await (prisma as any).vmAddon.update({
        where: { id: result.entitlement.id },
        data: {
          expiresAt: vps.renewalDueAt || vps.nextRenewalAt || null,
          metadata: {
            ...jsonRecord(result.entitlement.metadata),
            ipAddress: appliedIpResult.ipAddress,
            allocationId: appliedIpResult.allocationId || null,
            assignmentId: appliedIpResult.assignmentId || null,
            recurring: true,
            permanent: true,
            removable: false,
          },
        },
      }).catch(() => null)
    }
  }

  await Promise.all([
    createAuditLog({
      action: `${String(purchase.addonType).toUpperCase()}_PURCHASE_ACTIVATED`,
      actorEmail: input.actor || "system:addon-payment",
      customerId: purchase.customerId,
      targetType: "vps_instance",
      targetId: purchase.vpsInstanceId,
      newValue: {
        purchaseId: purchase.id,
        addonPlanId: purchase.addonPlanId,
        addonType: purchase.addonType,
        quantity,
      },
      metadata: { paymentId: input.paymentId || null, workerTaskId: result.workerTask.id },
    }),
    (prisma as any).vmAuditLog.create({
      data: {
        eventType: `${String(purchase.addonType).toUpperCase()}_PURCHASE_ACTIVATED`,
        severity: "INFO",
        actorType: "SYSTEM",
        actorEmail: input.actor || "system:addon-payment",
        vpsInstanceId: purchase.vpsInstanceId,
        customerId: purchase.customerId,
        orderId: vps.orderId || null,
        proxmoxNodeId: purchase.proxmoxNodeId || null,
        vmid: vps.vmid || null,
        targetType: "vm_addon_purchase",
        targetId: purchase.id,
        newValue: { purchaseId: purchase.id, addonPlanId: purchase.addonPlanId, addonType: purchase.addonType, quantity },
        status: "SUCCESS",
        metadata: { paymentId: input.paymentId || null, workerTaskId: result.workerTask.id },
      },
    }).catch(() => null),
  ])

  const templateKey = addonTemplateKey(String(purchase.addonType))
  if (templateKey && (vps.customer?.email || vps.customer?.phone)) {
    await sendNotification({
      type: "order",
      channels: ["whatsapp"],
      user: {
        id: vps.customerId || null,
        email: vps.customer?.email || null,
        phone: vps.customer?.phone || null,
        name: vps.customer?.name || null,
      },
      data: {
        templateKey,
        orderId: vps.orderId || null,
        vpsInstanceId: vps.id,
        server_name: vps.name,
        ip_address: appliedIpResult?.ipAddress || jsonRecord(purchase.metadata).reservation?.ipAddress || "",
        monthly_cost: formatInr(Number(purchase.amount || 0)),
        renewal_date: formatDate(vps.renewalDueAt || vps.nextRenewalAt),
        plan: addonPlan?.name || `${quantity} ${purchase.unit || ""}`.trim(),
        slots: String(quantity),
        schedule: String(jsonRecord(addonPlan?.metadata).schedule || "Daily"),
        status: "Active",
        metadata: { source: "addon_activation", addonType: purchase.addonType, vpsInstanceId: vps.id, eventStatus: `${purchase.addonType}_addon_activated` },
      },
    }).catch(() => null)
  }

  return { finalized: true, purchaseId: purchase.id, entitlementId: result.entitlement.id, workerTaskId: result.workerTask.id }
}

export async function applyVmAddonWorkerTask(input: { taskId: string; actor?: string | null }) {
  const task = await (prisma as any).vmAddonWorkerTask.findUnique({
    where: { id: input.taskId },
  })
  if (!task) throw new Error("Addon worker task not found")
  if (String(task.status).toLowerCase() === "completed") return { ok: true, taskId: task.id, alreadyCompleted: true }
  if (String(task.addonType) !== "ip") throw new Error(`Unsupported addon worker task: ${task.addonType}`)
  const [purchase, vps] = await Promise.all([
    task.purchaseId ? (prisma as any).vmAddonPurchase.findUnique({ where: { id: task.purchaseId } }).catch(() => null) : null,
    prisma.vpsInstance.findUnique({ where: { id: task.vpsInstanceId }, include: { customer: true, proxmoxNode: true, product: true } }),
  ])
  if (!vps) throw new Error("Addon VM not found")
  const payload = jsonRecord(task.payload)
  const purchaseMetadata = jsonRecord(purchase?.metadata)
  const reservation = jsonRecord(purchaseMetadata.reservation || payload.reservation)
  const poolId = purchase?.poolId || payload.poolId
  if (!poolId) throw new Error("No priced IP pool is associated with this addon purchase")

  const allocation = await prisma.$transaction(async (tx) => {
    let reserved = reservation.allocationId
      ? await (tx as any).ipAllocation.findUnique({ where: { id: String(reservation.allocationId) }, include: { pool: true } })
      : null
    if (reserved) {
      const existingAssignment = await (tx as any).ipAssignment.findFirst({
        where: { allocationId: reserved.id, vpsInstanceId: vps.id, status: { in: ["active", "assigned", "reserved"] } },
        orderBy: { createdAt: "desc" },
      }).catch(() => null)
      if (existingAssignment) {
        await (tx as any).vmAddonWorkerTask.update({
          where: { id: task.id },
          data: {
            status: "completed",
            attempts: { increment: 1 },
            completedAt: new Date(),
            result: {
              ipAddress: reserved.ipAddress,
              allocationId: reserved.id,
              assignmentId: existingAssignment.id,
              networkConfig: "already_assigned",
            },
          },
        })
        return { ipAddress: reserved.ipAddress, allocationId: reserved.id, assignmentId: existingAssignment.id, legacyAssignmentId: null }
      }
    }
    if (!reserved) {
      reserved = await reserveIpFromPool({
        poolId: String(poolId),
        proxmoxNodeId: vps.proxmoxNodeId || undefined,
        productId: vps.productId || undefined,
        region: vps.serviceLocation || vps.proxmoxNode?.location || undefined,
        vpsInstanceId: vps.id,
        vmid: vps.vmid || undefined,
        hostname: vps.name || undefined,
        assignedBy: input.actor || "system:addon-payment",
        purpose: "addon",
        forceOverride: false,
      }, tx as any)
    }
    const pool = (reserved as any).pool || await (tx as any).ipPool.findUnique({ where: { id: reserved.poolId } })
    await (tx as any).ipAllocation.update({
      where: { id: reserved.id },
      data: {
        status: "assigned",
        allocationLockKey: null,
        vpsInstanceId: vps.id,
        vmid: vps.vmid || null,
        hostname: vps.name || null,
        assignedBy: input.actor || "system:addon-payment",
      },
    }).catch(() => null)
    const legacyAssignment = await (tx as any).vmIpAssignment.create({
      data: {
        vpsInstanceId: vps.id,
        proxmoxNodeId: vps.proxmoxNodeId || null,
        vmid: vps.vmid || null,
        poolId: reserved.poolId,
        ipAllocationId: reserved.id,
        family: "ipv4",
        assignmentType: "address",
        role: "secondary",
        ipAddress: reserved.ipAddress,
        cidr: pool?.cidr || null,
        gateway: pool?.gateway || null,
        bridge: pool?.bridgeOverride || pool?.bridge || null,
        status: "active",
        isPrimary: false,
        metadata: { source: "addon_purchase", purchaseId: purchase?.id || null, taskId: task.id },
        attachedAt: new Date(),
      },
    })
    const canonicalAssignment = await (tx as any).ipAssignment.create({
      data: {
        vpsInstanceId: vps.id,
        customerId: vps.customerId || null,
        customerEmail: vps.customer?.email || null,
        vmid: vps.vmid || null,
        hostname: vps.name || null,
        nodeId: vps.proxmoxNodeId || null,
        nodeName: vps.proxmoxNode?.nodeName || vps.proxmoxNode?.name || null,
        poolId: reserved.poolId,
        poolName: pool?.name || null,
        allocationId: reserved.id,
        legacyAssignmentId: legacyAssignment.id,
        assignedIp: reserved.ipAddress,
        gateway: pool?.gateway || null,
        cidr: pool?.cidr || null,
        dns: pool?.dns || null,
        bridge: pool?.bridgeOverride || pool?.bridge || null,
        isPrimary: false,
        status: "active",
        billingIp: reserved.ipAddress,
        source: "addon_purchase",
        metadata: { purchaseId: purchase?.id || null, taskId: task.id },
      },
    })
    await (tx as any).ipHistory.create({
      data: {
        ip: reserved.ipAddress,
        assignedIp: reserved.ipAddress,
        vpsInstanceId: vps.id,
        vmid: vps.vmid || null,
        customerId: vps.customerId || null,
        customerEmail: vps.customer?.email || null,
        customerName: vps.customer?.name || null,
        hostname: vps.name || null,
        poolId: reserved.poolId,
        poolName: pool?.name || null,
        nodeId: vps.proxmoxNodeId || null,
        nodeName: vps.proxmoxNode?.nodeName || vps.proxmoxNode?.name || null,
        assignmentId: canonicalAssignment.id,
        allocationId: reserved.id,
        status: "active",
        reason: "addon_purchase",
        admin: input.actor || "system:addon-payment",
        source: "addon_purchase",
        metadata: { purchaseId: purchase?.id || null, taskId: task.id, role: "secondary" },
      },
    })
    await (tx as any).vmIpHistory.create({
      data: {
        ip: reserved.ipAddress,
        vpsInstanceId: vps.id,
        vmid: vps.vmid || null,
        customerId: vps.customerId || null,
        customerEmail: vps.customer?.email || null,
        poolId: reserved.poolId,
        poolName: pool?.name || null,
        nodeId: vps.proxmoxNodeId || null,
        nodeName: vps.proxmoxNode?.nodeName || vps.proxmoxNode?.name || null,
        assignmentId: legacyAssignment.id,
        allocationId: reserved.id,
        status: "active",
        reason: "addon_purchase",
        admin: input.actor || "system:addon-payment",
        source: "addon_purchase",
        metadata: { purchaseId: purchase?.id || null, taskId: task.id, role: "secondary", canonicalAssignmentId: canonicalAssignment.id },
      },
    }).catch(() => null)
    const cache = await (tx as any).vmNetworkCache.findUnique({ where: { vpsInstanceId: vps.id } }).catch(() => null)
    const nextAdditionalIps = [
      ...jsonArray(cache?.additionalIps).filter((entry) => String(entry?.ip || entry?.ipAddress || entry) !== reserved.ipAddress),
      {
        ip: reserved.ipAddress,
        ipAddress: reserved.ipAddress,
        assignmentId: canonicalAssignment.id,
        legacyAssignmentId: legacyAssignment.id,
        allocationId: reserved.id,
        poolId: reserved.poolId,
        gateway: pool?.gateway || null,
        cidr: pool?.cidr || null,
        bridge: pool?.bridgeOverride || pool?.bridge || null,
        source: "addon_purchase",
        attachedAt: new Date().toISOString(),
      },
    ]
    await (tx as any).vmNetworkCache.upsert({
      where: { vpsInstanceId: vps.id },
      create: {
        vpsInstanceId: vps.id,
        customerId: vps.customerId || null,
        proxmoxNodeId: vps.proxmoxNodeId || null,
        vmid: vps.vmid || null,
        primaryAssignedIp: vps.ipAddress || null,
        additionalIps: nextAdditionalIps,
        source: "addon_purchase",
        lastSyncedAt: new Date(),
        metadata: { purchaseId: purchase?.id || null, taskId: task.id },
      },
      update: {
        additionalIps: nextAdditionalIps,
        source: "addon_purchase",
        lastSyncedAt: new Date(),
        metadata: { ...jsonRecord(cache?.metadata), purchaseId: purchase?.id || null, lastAddonTaskId: task.id },
      },
    })
    await (tx as any).vmAddonWorkerTask.update({
      where: { id: task.id },
      data: {
        status: "completed",
        attempts: { increment: 1 },
        completedAt: new Date(),
        result: {
          ipAddress: reserved.ipAddress,
          allocationId: reserved.id,
          legacyAssignmentId: legacyAssignment.id,
          assignmentId: canonicalAssignment.id,
          networkConfig: "database_synced_reboot_or_guest_network_reload_required",
        },
      },
    })
    return { ipAddress: reserved.ipAddress, allocationId: reserved.id, assignmentId: canonicalAssignment.id, legacyAssignmentId: legacyAssignment.id }
  })

  await createAuditLog({
    action: "ADDITIONAL_IP_ASSIGNED",
    actorEmail: input.actor || "system:addon-payment",
    customerId: vps.customerId,
    targetType: "vps_instance",
    targetId: vps.id,
    newValue: allocation,
    metadata: { taskId: task.id, purchaseId: purchase?.id || null },
  }).catch(() => null)
  return { ok: true, taskId: task.id, ...allocation }
}

export async function removeVmAddon(input: {
  vpsId: string
  customerId?: string | null
  addonId: string
  actorEmail?: string | null
}) {
  const addon = await (prisma as any).vmAddon.findFirst({
    where: {
      id: input.addonId,
      vpsInstanceId: input.vpsId,
      ...(input.customerId ? { customerId: input.customerId } : {}),
      status: "active",
    },
  })
  if (!addon) throw new Error("Active addon not found")
  if (String(addon.addonType) === "ip") throw new Error("Additional IPv4 is permanent and cannot be removed")
  const invoice = await prisma.invoice.findFirst({
    where: {
      customerId: addon.customerId || input.customerId || undefined,
      deletedAt: null,
      status: { in: ["draft", "sent", "pending", "overdue"] },
      metadata: { path: ["vpsInstanceId"], equals: input.vpsId },
    },
    select: { id: true, invoiceNumber: true },
    orderBy: { createdAt: "desc" },
  }).catch(() => null)
  if (invoice) throw new Error("This addon can be removed before the renewal invoice is generated")
  const removedAt = new Date()
  const updated = await (prisma as any).vmAddon.update({
    where: { id: addon.id },
    data: {
      status: "removed",
      expiresAt: removedAt,
      metadata: { ...jsonRecord(addon.metadata), removedAt: removedAt.toISOString(), removedBy: input.actorEmail || "customer" },
    },
  })
  await createAuditLog({
    action: `${String(addon.addonType).toUpperCase()}_ADDON_REMOVED`,
    actorEmail: input.actorEmail || "customer",
    customerId: addon.customerId || input.customerId || null,
    targetType: "vps_instance",
    targetId: input.vpsId,
    oldValue: { addonId: addon.id, addonType: addon.addonType, status: addon.status },
    newValue: { addonId: addon.id, status: "removed" },
  }).catch(() => null)
  return { removed: true, addon: updated }
}

export async function releaseExpiredAddonReservations(limit = 100) {
  const now = new Date()
  const purchases = await (prisma as any).vmAddonPurchase.findMany({
    where: {
      addonType: "ip",
      status: { in: PENDING_PURCHASE_STATUSES },
      expiresAt: { lt: now },
    },
    take: limit,
    orderBy: { expiresAt: "asc" },
  }).catch(() => [])
  let released = 0
  for (const purchase of purchases) {
    const metadata = jsonRecord(purchase.metadata)
    const reservation = jsonRecord(metadata.reservation)
    const allocationId = reservation.allocationId ? String(reservation.allocationId) : null
    await prisma.$transaction(async (tx) => {
      const invoice = purchase.invoiceId ? await tx.invoice.findUnique({ where: { id: purchase.invoiceId } }).catch(() => null) : null
      if (invoice && ["paid", "completed"].includes(String(invoice.status || "").toLowerCase())) return
      await (tx as any).vmAddonPurchase.update({
        where: { id: purchase.id },
        data: {
          status: "expired",
          metadata: { ...metadata, expiredAt: now.toISOString(), reservationReleased: Boolean(allocationId) },
        },
      })
      if (invoice && !["paid", "completed", "cancelled", "expired"].includes(String(invoice.status || "").toLowerCase())) {
        await tx.invoice.update({ where: { id: invoice.id }, data: { status: "expired" } }).catch(() => null)
      }
      if (allocationId) {
        const assignment = await (tx as any).ipAssignment.findFirst({ where: { allocationId, status: { in: ["active", "assigned", "reserved"] } } }).catch(() => null)
        if (!assignment) {
          await (tx as any).ipAllocation.update({
            where: { id: allocationId },
            data: { status: "free", vpsInstanceId: null, vmid: null, hostname: null, allocationLockKey: null, releasedAt: now },
          }).catch(() => null)
          released += 1
        }
      }
    }).catch(() => null)
  }
  return { checked: purchases.length, released }
}
