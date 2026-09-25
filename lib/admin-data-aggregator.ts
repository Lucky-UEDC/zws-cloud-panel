import { prisma } from "@/lib/db"
import { safeJson } from "@/lib/safe-json"
import { computeNormalizedPlatformStatus, type NormalizedPlatformStatus } from "@/lib/platform-status-engine"
import { classifyEnterpriseError } from "@/lib/enterprise-error-classifier"
import { getStartupSchemaCheck } from "@/lib/startup-schema-check"
import { buildProvisioningChecklist, type ProvisioningChecklistItem } from "@/lib/provisioning-checklist"

const ACTIVE_IP_ALLOC_STATUSES = ["RESERVED", "reserved", "ASSIGNED", "assigned", "USED", "used"]
const CACHE_TTL_MS = 20_000
const DEFAULT_PAGE_SIZE = 50
const MAX_PAGE_SIZE = 200

type AggregatorCacheEntry = {
  expiresAt: number
  payload: AggregatedAdminData
}

const cache = new Map<string, AggregatorCacheEntry>()

export type AdminAggregateFilters = {
  page?: number
  pageSize?: number
  includeDeleted?: boolean
  status?: string | null
  search?: string | null
  forceRefresh?: boolean
}

export type AdminOrderHealthRow = {
  order: {
    id: string
    orderNumber: string
    status: string
    orderType: string | null
    provisioningStatus: string | null
    provisioningError: string | null
    createdAt: string
    deletedAt: string | null
    payableAmount: number
    totalAmount: number
    billingTerm: number | null
    nodeId: string | null
    nodeName: string | null
    operatingSystem: { id: string; name: string; osFamily: string | null; osVersion: string | null; osType: string | null; category: string | null } | null
  }
  customer: { id: string; email: string; name: string | null } | null
  invoice: { id: string; invoiceNumber: string; status: string; totalAmount: number; dueDate: string | null; paidAt: string | null } | null
  payment: {
    id: string
    status: string
    gateway: string
    amount: number
    createdAt: string
    gatewayOrderId: string | null
    gatewayPaymentId: string | null
    transactionId: string | null
    verified: boolean
    verifiedAt: string | null
  } | null
  vm: {
    id: string
    name: string
    vmid: number
    status: string
    ipAddress: string | null
    os: string | null
    cpuCores: number | null
    ramGb: number | null
    diskGb: number | null
    nodeName: string | null
    nextRenewalAt: string | null
    renewalDueAt: string | null
    suspendAt: string | null
    penaltyAt: string | null
    terminationAt: string | null
    deletionAt: string | null
    penaltyAppliedAt: string | null
    lastReminderLevel: string | null
    lastReminderSentAt: string | null
    autoSuspendEnabled: boolean | null
    autoDeleteEnabled: boolean | null
    automationPausedAt: string | null
    remindersPausedAt: string | null
    renewalAmount: number | null
  } | null
  vmCount: number
  bulk: {
    bulkGroupId: string | null
    bulkIndex: number | null
    bulkQuantity: number | null
    groupHostnames: string[]
    provisioningProgress: number
  } | null
  provisioning: {
    status: string | null
    jobId: string | null
    jobStatus: string | null
    displayStatus: string | null
    latestUpid: string | null
    error: string | null
    source: "order" | "vm" | "none"
  }
  provisioningChecklist: ProvisioningChecklistItem[]
  network: {
    primaryAssignedIp: string | null
    eventStatus: string | null
    lastEventType: string | null
    issues: string[]
  }
  renewal: {
    type: "vm" | "dedicated" | "none"
    nextRenewalAt: string | null
    renewalAmount: number | null
  }
  health: NormalizedPlatformStatus
  diagnostics: {
    supportCode: string
    issues: string[]
    staleVmState: boolean
  }
  dedicated: {
    id: string
    status: string
    serviceNumber: string
    primaryIp: string | null
    nextRenewalAt: string | null
    renewalAmount: number | null
  } | null
}

export type AdminConsistencyReport = {
  checkedAt: string
  totals: {
    ordersScanned: number
    vmRows: number
  }
  issues: {
    paidWithoutService: number
    vmWithoutProvisioningLink: number
    ipOwnershipMismatch: number
    activeInvoiceMismatch: number
    orphanProvisioningJobs: number
    orphanVms: number
  }
  samples: {
    paidWithoutServiceOrderIds: string[]
    vmWithoutProvisioningOrderIds: string[]
    ipMismatchOrderIds: string[]
  }
}

export type AggregatedAdminData = {
  rows: AdminOrderHealthRow[]
  pagination: {
    page: number
    pageSize: number
    total: number
    pages: number
  }
  consistency: AdminConsistencyReport
  diagnosticsSummary: {
    rowsWithIssues: number
    staleVmStates: number
    networkMismatch: number
    provisioningFailed: number
    paymentFailed: number
  }
  degraded?: {
    degradedMode: boolean
    degradedReasons: string[]
  }
  vmStatusPartial?: boolean
  partialWarnings?: string[]
  startupSchema?: {
    ok: boolean
    checkedAt: string
    missingTables: string[]
    missingColumns: Array<{ table: string; column: string }>
    pendingMigrations: string[]
    failedMigrations: string[]
    pendingDeploy: boolean
    degradedFeatures: string[]
    failedStartupChecks: string[]
  }
}

function toNumber(value: unknown, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function asIso(value: Date | string | null | undefined) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function normalizePagination(input: AdminAggregateFilters) {
  const page = Math.max(1, Number(input.page || 1))
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(input.pageSize || DEFAULT_PAGE_SIZE)))
  return { page, pageSize }
}

function buildCacheKey(input: AdminAggregateFilters) {
  const { page, pageSize } = normalizePagination(input)
  return JSON.stringify({
    page,
    pageSize,
    includeDeleted: Boolean(input.includeDeleted),
    status: String(input.status || ""),
    search: String(input.search || "").toLowerCase(),
  })
}

function buildWhere(input: AdminAggregateFilters): Record<string, any> {
  const includeDeleted = input.includeDeleted === true
  const status = String(input.status || "").trim()
  const search = String(input.search || "").trim()

  const where: Record<string, any> = {
    ...(includeDeleted ? {} : { deletedAt: null }),
  }

  if (status && status !== "all") where.status = status

  if (search) {
    where.OR = [
      { orderNumber: { contains: search, mode: "insensitive" } },
      { customer: { email: { contains: search, mode: "insensitive" } } },
      { customer: { name: { contains: search, mode: "insensitive" } } },
      { product: { name: { contains: search, mode: "insensitive" } } },
      { offer: { name: { contains: search, mode: "insensitive" } } },
      { vpsInstance: { name: { contains: search, mode: "insensitive" } } },
      { dedicatedService: { serviceNumber: { contains: search, mode: "insensitive" } } },
    ]
  }

  return where
}

function buildRowDiagnostics(row: AdminOrderHealthRow) {
  const issues = [...row.network.issues]

  if (["paid", "active", "completed", "payment_verified"].includes(String(row.order.status || "").toLowerCase())) {
    if (!row.vm && !row.dedicated && row.provisioning.source === "none") {
      issues.push("paid_order_without_service_link")
    }
  }

  if (row.vm && row.provisioning.source === "none") {
    issues.push("vm_without_provisioning_link")
  }

  if (row.invoice?.status?.toLowerCase() === "paid" && row.health.payment === "pending") {
    issues.push("invoice_paid_payment_pending")
  }

  const staleVmState = Boolean(
    row.vm &&
      row.health.provisioning === "failed" &&
      row.health.vm === "running",
  )

  return {
    issues,
    staleVmState,
  }
}

function createSupportCode(orderId: string) {
  return `ADM-VM-${String(orderId || "unknown").slice(-8).toUpperCase()}`
}

function logAdminAggregation(message: string, details: Record<string, unknown> = {}) {
  console.info("[ADMIN_ORDER_VM_AGGREGATION]", message, details)
}

function warnAdminAggregation(message: string, details: Record<string, unknown> = {}) {
  console.warn("[ADMIN_ORDER_VM_AGGREGATION]", message, details)
}

function metadataRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {}
}

function textOrNull(value: unknown) {
  const text = String(value || "").trim()
  return text || null
}

export async function getAggregatedAdminData(input: AdminAggregateFilters = {}): Promise<AggregatedAdminData> {
  const aggregationStartedAt = Date.now()
  const cacheKey = buildCacheKey(input)
  const forceRefresh = input.forceRefresh === true
  const cached = cache.get(cacheKey)

  if (!forceRefresh && cached && cached.expiresAt > Date.now()) {
    return safeJson(cached.payload)
  }

  const { page, pageSize } = normalizePagination(input)
  const where = buildWhere(input)

  const ordersBaseInclude = {
    customer: { select: { id: true, email: true, name: true } },
    product: { select: { id: true, name: true, defaultNodeId: true } },
    proxmoxServer: { select: { id: true, name: true, nodeName: true } },
    offer: { select: { id: true, name: true, slug: true } },
    invoices: { select: { id: true, invoiceNumber: true, status: true, totalAmount: true, dueDate: true, paidAt: true } },
    payments: { orderBy: { createdAt: "desc" }, take: 3, include: { paymentAttempts: { orderBy: { createdAt: "desc" }, take: 1 } } },
    provisioningJobs: { orderBy: { createdAt: "desc" }, take: 1, include: { steps: { orderBy: { createdAt: "asc" }, select: { step: true, status: true, completedAt: true, startedAt: true } } } },
    vpsInstance: {
      include: {
        proxmoxNode: { select: { id: true, nodeName: true, name: true } },
        operatingSystem: { select: { id: true, name: true, osFamily: true, osVersion: true, osType: true, category: true } },
        product: { select: { id: true, name: true, cpuCores: true, ramGb: true, storageGb: true } },
        ipAllocations: {
          where: { status: { in: ACTIVE_IP_ALLOC_STATUSES as any } },
          take: 3,
          orderBy: { createdAt: "desc" },
          include: { pool: { select: { id: true, name: true } } },
        },
        provisioningJobs: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            id: true,
            status: true,
            displayStatus: true,
            currentStep: true,
            latestUpid: true,
            error: true,
            startedAt: true,
            completedAt: true,
            steps: { orderBy: { createdAt: "asc" }, select: { step: true, status: true, completedAt: true, startedAt: true } },
          },
        },
      },
    },
    dedicatedService: {
      select: {
        id: true,
        status: true,
        serviceNumber: true,
        primaryIp: true,
        nextRenewalAt: true,
        renewalAmount: true,
      },
    },
  } as const

  const ordersMinimalInclude = {
    customer: { select: { id: true, email: true, name: true } },
    product: { select: { id: true, name: true } },
    offer: { select: { id: true, name: true, slug: true } },
    invoices: { select: { id: true, invoiceNumber: true, status: true, totalAmount: true, dueDate: true, paidAt: true } },
    payments: { orderBy: { createdAt: "desc" as const }, take: 3 },
    provisioningJobs: { orderBy: { createdAt: "desc" }, take: 1 },
    dedicatedService: {
      select: {
        id: true,
        status: true,
        serviceNumber: true,
        primaryIp: true,
        nextRenewalAt: true,
        renewalAmount: true,
      },
    },
  } as const

  const ordersAdvancedInclude = {
    ...ordersBaseInclude,
    vpsInstance: {
      include: {
        ...ordersBaseInclude.vpsInstance.include,
        vmIpAssignments: {
          where: { status: "active" },
          orderBy: { createdAt: "desc" },
          take: 6,
          select: {
            id: true,
            family: true,
            role: true,
            isPrimary: true,
            ipAddress: true,
            gateway: true,
            cidr: true,
            bridge: true,
            vlanTag: true,
          },
        },
        vmNetworkEvents: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            id: true,
            status: true,
            eventType: true,
            errorCode: true,
            errorMessage: true,
            metadata: true,
            createdAt: true,
          },
        },
      },
    },
  } as const

  let degradedMode = false
  const degradedReasons: string[] = []
  let vmStatusPartial = false
  const partialWarnings: string[] = []

  const [total, orders, orphanProvisioningJobs, orphanVms] = await Promise.all([
    prisma.order.count({ where }),
    (async () => {
      const fetchStartedAt = Date.now()
      try {
        const result = await prisma.order.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * pageSize,
          take: pageSize,
          include: ordersAdvancedInclude as any,
        })
        logAdminAggregation("orders_fetch_complete", { mode: "advanced", ms: Date.now() - fetchStartedAt, rows: result.length })
        return result
      } catch (error) {
        const classified = classifyEnterpriseError(error)
        degradedMode = true
        vmStatusPartial = true
        degradedReasons.push(classified.kind)
        partialWarnings.push(`advanced_vm_query_${classified.kind}`)
        warnAdminAggregation("advanced_vm_query_failed", { kind: classified.kind, code: classified.code })

        if (classified.kind !== "migration_missing" && classified.kind !== "schema_mismatch") {
          try {
            const result = await prisma.order.findMany({
              where,
              orderBy: { createdAt: "desc" },
              skip: (page - 1) * pageSize,
              take: pageSize,
              include: ordersMinimalInclude as any,
            })
            logAdminAggregation("orders_fetch_complete", { mode: "minimal", ms: Date.now() - fetchStartedAt, rows: result.length })
            return result
          } catch {
            throw error
          }
        }

        try {
          const result = await prisma.order.findMany({
            where,
            orderBy: { createdAt: "desc" },
            skip: (page - 1) * pageSize,
            take: pageSize,
            include: ordersBaseInclude as any,
          })
          logAdminAggregation("orders_fetch_complete", { mode: "base", ms: Date.now() - fetchStartedAt, rows: result.length })
          return result
        } catch (baseError) {
          const baseClassified = classifyEnterpriseError(baseError)
          partialWarnings.push(`base_vm_query_${baseClassified.kind}`)
          warnAdminAggregation("base_vm_query_failed", { kind: baseClassified.kind, code: baseClassified.code })
        }

        const result = await prisma.order.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * pageSize,
          take: pageSize,
          include: ordersMinimalInclude as any,
        })
        logAdminAggregation("orders_fetch_complete", { mode: "minimal", ms: Date.now() - fetchStartedAt, rows: result.length })
        return result
      }
    })(),
    prisma.provisioningJob.count({
      where: {
        orderId: null,
        vpsInstanceId: null,
        status: { in: ["queued", "running", "failed", "waiting_for_admin"] },
      },
    }),
    prisma.vpsInstance.count({
      where: {
        deletedAt: null,
        order: { deletedAt: { not: null } },
      },
    }).catch((error) => {
      const classified = classifyEnterpriseError(error)
      warnAdminAggregation("orphan_vm_count_failed", { kind: classified.kind, code: classified.code })
      return 0
    }),
  ])

  const bulkGroups = new Map<string, { hostnames: string[]; total: number; active: number }>()
  for (const order of orders as any[]) {
    const metadata = metadataRecord(order.metadata)
    const bulkGroupId = textOrNull(metadata.bulkGroupId)
    if (!bulkGroupId) continue
    const current = bulkGroups.get(bulkGroupId) || { hostnames: [], total: 0, active: 0 }
    current.total += 1
    if (order.hostname) current.hostnames.push(String(order.hostname))
    if (["active", "completed", "provisioned"].includes(String(order.provisioningStatus || "").toLowerCase())) current.active += 1
    bulkGroups.set(bulkGroupId, current)
  }

  const rows: AdminOrderHealthRow[] = orders.map((order: any) => {
    const latestInvoice = Array.isArray(order.invoices) ? order.invoices[0] : order.invoices || null
    const latestPayment = Array.isArray(order.payments) ? order.payments[0] : null
    const orderJob = Array.isArray(order.provisioningJobs) ? order.provisioningJobs[0] : null
    const vm = order.vpsInstance || null
    const vmJob = vm?.provisioningJobs?.[0] || null
    const latestJob = orderJob || vmJob || null

    const vmIpAssignments = Array.isArray(vm?.vmIpAssignments) ? vm.vmIpAssignments : []
    const vmNetworkEvents = Array.isArray(vm?.vmNetworkEvents) ? vm.vmNetworkEvents : []
    const primaryAssignment = vmIpAssignments.find((item: any) => item.isPrimary && item.family === "ipv4") || null
    const networkEvent = vmNetworkEvents[0] || null

    const networkIssues: string[] = []
    if (vm?.ipAddress && primaryAssignment?.ipAddress && vm.ipAddress !== primaryAssignment.ipAddress) {
      networkIssues.push("vps_ip_mismatch")
    }
    if (networkEvent?.status === "warning" || networkEvent?.status === "failed") {
      networkIssues.push("network_event_warning")
    }
    if (vm && !vm.ipAddress && ["active", "running"].includes(String(vm.status || "").toLowerCase())) {
      networkIssues.push("running_vm_without_primary_ip")
    }

    if (!vm && !order.dedicatedService) {
      warnAdminAggregation("missing_vm_for_order", { orderId: String(order.id), status: String(order.status || "pending"), provisioningStatus: String(order.provisioningStatus || "pending") })
    } else if (vm && !vm.proxmoxNode) {
      warnAdminAggregation("missing_node_for_vm", { orderId: String(order.id), vpsInstanceId: String(vm.id), vmid: Number(vm.vmid || 0) })
    }
    if (vm && !vm.ipAddress && !primaryAssignment?.ipAddress) {
      warnAdminAggregation("missing_ip_for_vm", { orderId: String(order.id), vpsInstanceId: String(vm.id), vmid: Number(vm.vmid || 0), status: String(vm.status || "unknown") })
    }

    const metadata = metadataRecord(order.metadata)
    const bulkGroupId = textOrNull(metadata.bulkGroupId)
    const bulkGroup = bulkGroupId ? bulkGroups.get(bulkGroupId) : null
    const bulkQuantity = Number(metadata.bulkQuantity || bulkGroup?.total || 0)
    const bulkIndex = Number(metadata.bulkIndex || 0)

    const health = computeNormalizedPlatformStatus({
      paymentStatus: latestPayment?.status || null,
      orderStatus: order.status,
      provisioningStatus: order.provisioningStatus,
      jobStatus: latestJob?.status || null,
      vmStatus: vm?.status || null,
      networkIssues,
      networkEventStatus: networkEvent?.status || null,
      vmIpAddress: vm?.ipAddress || null,
      primaryAssignedIp: primaryAssignment?.ipAddress || null,
    })

    const row: AdminOrderHealthRow = {
      order: {
        id: String(order.id),
        orderNumber: String(order.orderNumber || order.id),
        status: String(order.status || "pending"),
        orderType: order.orderType || null,
        provisioningStatus: order.provisioningStatus || null,
        provisioningError: order.provisioningError || null,
        createdAt: asIso(order.createdAt) || new Date().toISOString(),
        deletedAt: asIso(order.deletedAt),
        payableAmount: toNumber(order.payableAmount ?? order.finalAmount ?? order.totalAmount),
        totalAmount: toNumber(order.totalAmount),
        billingTerm: order.termMonths === null || order.termMonths === undefined ? null : toNumber(order.termMonths, 1),
        nodeId: order.proxmoxNodeId || order.product?.defaultNodeId || null,
        nodeName: order.proxmoxServer?.name || order.proxmoxServer?.nodeName || null,
        operatingSystem: order.operatingSystem ? {
          id: String(order.operatingSystem.id),
          name: String(order.operatingSystem.name || ""),
          osFamily: order.operatingSystem.osFamily || null,
          osVersion: order.operatingSystem.osVersion || null,
          osType: order.operatingSystem.osType || null,
          category: order.operatingSystem.category || null,
        } : null,
      },
      customer: order.customer
        ? {
            id: String(order.customer.id),
            email: String(order.customer.email || ""),
            name: order.customer.name || null,
          }
        : null,
      invoice: latestInvoice
        ? {
            id: String(latestInvoice.id),
            invoiceNumber: String(latestInvoice.invoiceNumber || ""),
            status: String(latestInvoice.status || "pending"),
            totalAmount: toNumber(latestInvoice.totalAmount),
            dueDate: asIso(latestInvoice.dueDate),
            paidAt: asIso(latestInvoice.paidAt),
          }
        : null,
      payment: latestPayment
        ? {
            id: String(latestPayment.id),
            status: String(latestPayment.status || "pending"),
            gateway: String(latestPayment.gateway || "unknown"),
            amount: toNumber(latestPayment.amount),
            createdAt: asIso(latestPayment.createdAt) || new Date().toISOString(),
            gatewayOrderId: latestPayment.gatewayOrderId || null,
            gatewayPaymentId: latestPayment.gatewayPaymentId || null,
            transactionId: latestPayment.gatewayTransactionId || latestPayment.transactionId || latestPayment.gatewayPaymentId || null,
            verified: ["completed", "paid", "success"].includes(String(latestPayment.status || "").toLowerCase()) && Boolean(latestPayment.paymentAttempts?.[0]?.webhookVerifiedAt || latestPayment.completedAt),
            verifiedAt: asIso(latestPayment.paymentAttempts?.[0]?.webhookVerifiedAt || latestPayment.completedAt),
          }
        : null,
      vm: vm
        ? {
            id: String(vm.id),
            name: String(vm.name || "Virtual Machine"),
            vmid: Number(vm.vmid || 0),
            status: String(vm.status || "Unknown"),
            ipAddress: vm.ipAddress || null,
            os: vm.operatingSystem?.name || order.osName || null,
            cpuCores: vm.cpuCores || vm.product?.cpuCores || null,
            ramGb: vm.ramGb || vm.product?.ramGb || null,
            diskGb: vm.diskGb || vm.product?.storageGb || null,
            nodeName: vm.proxmoxNode?.nodeName || vm.proxmoxNode?.name || null,
            nextRenewalAt: asIso((vm as any).renewalDueAt || vm.nextRenewalAt),
            renewalDueAt: asIso((vm as any).renewalDueAt || vm.nextRenewalAt),
            suspendAt: asIso((vm as any).suspendAt),
            penaltyAt: asIso((vm as any).penaltyAt),
            terminationAt: asIso((vm as any).terminationAt),
            deletionAt: asIso((vm as any).deletionAt),
            penaltyAppliedAt: asIso((vm as any).penaltyAppliedAt),
            lastReminderLevel: (vm as any).lastReminderLevel || null,
            lastReminderSentAt: asIso((vm as any).lastReminderSentAt),
            autoSuspendEnabled: (vm as any).autoSuspendEnabled ?? null,
            autoDeleteEnabled: (vm as any).autoDeleteEnabled ?? null,
            automationPausedAt: asIso((vm as any).automationPausedAt),
            remindersPausedAt: asIso((vm as any).remindersPausedAt),
            renewalAmount: vm.renewalAmount === null || vm.renewalAmount === undefined ? null : toNumber(vm.renewalAmount),
          }
        : null,
      vmCount: vm ? 1 : 0,
      bulk: bulkGroupId
        ? {
            bulkGroupId,
            bulkIndex: Number.isFinite(bulkIndex) && bulkIndex > 0 ? bulkIndex : null,
            bulkQuantity: Number.isFinite(bulkQuantity) && bulkQuantity > 0 ? bulkQuantity : null,
            groupHostnames: bulkGroup?.hostnames || [],
            provisioningProgress: bulkGroup?.total ? Math.round((bulkGroup.active / bulkGroup.total) * 100) : 0,
          }
        : null,
      provisioning: {
        status: order.provisioningStatus || "Pending",
        jobId: latestJob?.id ? String(latestJob.id) : null,
        jobStatus: latestJob?.status ? String(latestJob.status) : null,
        displayStatus: latestJob?.displayStatus ? String(latestJob.displayStatus) : (order.provisioningStatus || "Pending"),
        latestUpid: latestJob?.latestUpid ? String(latestJob.latestUpid) : null,
        error: (latestJob?.error || order.provisioningError || null) as string | null,
        source: orderJob ? "order" : vmJob ? "vm" : "none",
      },
      provisioningChecklist: buildProvisioningChecklist({ order, invoice: latestInvoice, payment: latestPayment, vm, job: latestJob }),
      network: {
        primaryAssignedIp: primaryAssignment?.ipAddress || null,
        eventStatus: networkEvent?.status ? String(networkEvent.status) : null,
        lastEventType: networkEvent?.eventType ? String(networkEvent.eventType) : null,
        issues: networkIssues,
      },
      renewal: vm
        ? {
            type: "vm",
            nextRenewalAt: asIso((vm as any).renewalDueAt || vm.nextRenewalAt),
            renewalAmount: vm.renewalAmount === null || vm.renewalAmount === undefined ? null : toNumber(vm.renewalAmount),
          }
        : order.dedicatedService
          ? {
              type: "dedicated",
              nextRenewalAt: asIso(order.dedicatedService.nextRenewalAt),
              renewalAmount: order.dedicatedService.renewalAmount === null || order.dedicatedService.renewalAmount === undefined
                ? null
                : toNumber(order.dedicatedService.renewalAmount),
            }
          : {
              type: "none",
              nextRenewalAt: null,
              renewalAmount: null,
            },
      health,
      diagnostics: {
        supportCode: createSupportCode(String(order.id)),
        issues: [],
        staleVmState: false,
      },
      dedicated: order.dedicatedService
        ? {
            id: String(order.dedicatedService.id),
            status: String(order.dedicatedService.status || "pending"),
            serviceNumber: String(order.dedicatedService.serviceNumber || ""),
            primaryIp: order.dedicatedService.primaryIp || null,
            nextRenewalAt: asIso(order.dedicatedService.nextRenewalAt),
            renewalAmount: order.dedicatedService.renewalAmount === null || order.dedicatedService.renewalAmount === undefined
              ? null
              : toNumber(order.dedicatedService.renewalAmount),
          }
        : null,
    }

    const diagnostics = buildRowDiagnostics(row)
    row.diagnostics.issues = diagnostics.issues
    row.diagnostics.staleVmState = diagnostics.staleVmState

    return row
  })

  const paidWithoutService = rows.filter((row) => row.diagnostics.issues.includes("paid_order_without_service_link"))
  const vmWithoutProvisioning = rows.filter((row) => row.diagnostics.issues.includes("vm_without_provisioning_link"))
  const ipOwnershipMismatch = rows.filter((row) => row.diagnostics.issues.includes("vps_ip_mismatch"))
  const activeInvoiceMismatch = rows.filter((row) => row.diagnostics.issues.includes("invoice_paid_payment_pending"))

  const consistency: AdminConsistencyReport = {
    checkedAt: new Date().toISOString(),
    totals: {
      ordersScanned: rows.length,
      vmRows: rows.filter((row) => Boolean(row.vm)).length,
    },
    issues: {
      paidWithoutService: paidWithoutService.length,
      vmWithoutProvisioningLink: vmWithoutProvisioning.length,
      ipOwnershipMismatch: ipOwnershipMismatch.length,
      activeInvoiceMismatch: activeInvoiceMismatch.length,
      orphanProvisioningJobs: Number(orphanProvisioningJobs || 0),
      orphanVms: Number(orphanVms || 0),
    },
    samples: {
      paidWithoutServiceOrderIds: paidWithoutService.slice(0, 10).map((row) => row.order.id),
      vmWithoutProvisioningOrderIds: vmWithoutProvisioning.slice(0, 10).map((row) => row.order.id),
      ipMismatchOrderIds: ipOwnershipMismatch.slice(0, 10).map((row) => row.order.id),
    },
  }

  const startupSchema = await getStartupSchemaCheck().catch(() => ({
    ok: false,
    checkedAt: new Date().toISOString(),
    missingTables: [] as string[],
    missingColumns: [] as Array<{ table: string; column: string }>,
    pendingMigrations: [] as string[],
    failedMigrations: [] as string[],
    pendingDeploy: false,
    degradedMode: true,
    degradedFeatures: [] as string[],
    failedStartupChecks: ["startup_schema_check_failed"],
    safeMode: {
      advancedVmNetworkingEnabled: false,
      ipAssignmentLayerEnabled: false,
      networkTimelineEnabled: false,
      ordersEnabled: true,
      vmListEnabled: true,
      provisioningEnabled: true,
      billingEnabled: true,
    },
  }))

  const payload: AggregatedAdminData = {
    rows,
    pagination: {
      page,
      pageSize,
      total,
      pages: Math.max(1, Math.ceil(total / pageSize)),
    },
    consistency,
    diagnosticsSummary: {
      rowsWithIssues: rows.filter((row) => row.diagnostics.issues.length > 0).length,
      staleVmStates: rows.filter((row) => row.diagnostics.staleVmState).length,
      networkMismatch: rows.filter((row) => row.health.network === "mismatch").length,
      provisioningFailed: rows.filter((row) => row.health.provisioning === "failed").length,
      paymentFailed: rows.filter((row) => row.health.payment === "failed").length,
    },
    degraded: {
      degradedMode: degradedMode || startupSchema.degradedMode,
      degradedReasons: Array.from(new Set([
        ...degradedReasons,
        ...(startupSchema.degradedMode ? startupSchema.degradedFeatures : []),
      ])),
    },
    vmStatusPartial,
    partialWarnings: Array.from(new Set(partialWarnings)),
    startupSchema: {
      ok: startupSchema.ok,
      checkedAt: startupSchema.checkedAt,
      missingTables: startupSchema.missingTables,
      missingColumns: startupSchema.missingColumns,
      pendingMigrations: startupSchema.pendingMigrations,
      failedMigrations: startupSchema.failedMigrations,
      pendingDeploy: startupSchema.pendingDeploy,
      degradedFeatures: startupSchema.degradedFeatures,
      failedStartupChecks: startupSchema.failedStartupChecks,
    },
  }

  cache.set(cacheKey, {
    expiresAt: Date.now() + CACHE_TTL_MS,
    payload,
  })

  logAdminAggregation("aggregation_complete", { ms: Date.now() - aggregationStartedAt, rows: rows.length, vmRows: consistency.totals.vmRows, vmStatusPartial })

  return safeJson(payload)
}

export function clearAdminAggregationCache() {
  cache.clear()
}
