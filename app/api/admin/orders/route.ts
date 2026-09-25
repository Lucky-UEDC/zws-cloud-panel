import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { getAdminFromCookies } from "@/lib/server-auth"
import { apiError, apiSuccess } from "@/lib/api-response"
import { createInvoiceForOrder } from "@/lib/invoices"
import { invoiceTaxWriteFields } from "@/lib/invoices/tax"
import { encryptSecret, generateRandomPassword, isValidLinuxHostname } from "@/lib/provision"
import { parseSshPublicKey } from "@/lib/ssh-keys"
import { createPanelLog } from "@/lib/panel-log"
import { offerAvailability, snapshotOffer } from "@/lib/offers"
import { writeAuditLog } from "@/lib/audit-log"
import { handlePaidInvoice } from "@/lib/payment-finalization"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { generateBulkGroupId, generateVmHostnames, hasBulkDiscount, normalizeOrderQuantity, planHostnameSlug, customerHostnameSlug } from "@/lib/order-bulk"
import { validateProvisioningPreflight } from "@/lib/provisioning-placement"
import { resolveAutoProvisionForProduct } from "@/lib/auto-provision"
import { bindExistingVmToOrder, loadExistingVmPreview } from "@/lib/admin-vm-management"
import { billingCycleForTerm, calculateAdminOrderPreview, normalizeAdminProvisioningMode } from "@/lib/admin-order-preview"
import { lifecycleDates } from "@/lib/renewals"
import { persistVpsConsoleMetadata } from "@/lib/console-metadata"

function money(value: unknown) {
  const n = Number(value || 0)
  return Number.isFinite(n) ? n : 0
}

function generateOrderNumber(): string {
  const timestamp = Date.now().toString(36).toUpperCase()
  const random = Math.random().toString(36).substring(2, 6).toUpperCase()
  return `ZWS-${timestamp}-${random}`
}

function invoiceNumberFor(orderNumber: string) {
  return `INV-${orderNumber.replace(/[^a-zA-Z0-9-]/g, "").replace(/^-+/, "")}`
}

function parseAdminDateInput(value: unknown) {
  const raw = String(value || "").trim()
  if (!raw) return { date: null as Date | null, error: null as string | null }
  let year = 0
  let month = 0
  let day = 0
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  const dmy = raw.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/)
  if (iso) {
    year = Number(iso[1])
    month = Number(iso[2])
    day = Number(iso[3])
  } else if (dmy) {
    day = Number(dmy[1])
    month = Number(dmy[2])
    year = Number(dmy[3])
  } else {
    return { date: null, error: "Use YYYY-MM-DD or DD-MM-YYYY date format" }
  }
  const date = new Date(Date.UTC(year, month - 1, day, 0, 0, 0))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return { date: null, error: "Invalid calendar date" }
  }
  return { date, error: null }
}

function text(value: unknown) {
  return String(value || "").trim()
}

function numberOrNull(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function directServicePayload(body: any, mode: "external_vm_attachment" | "manual_provision_complete") {
  const external = mode === "external_vm_attachment"
  const prefix = external ? "external" : "manual"
  const provider = text(body[`${prefix}Provider`] || body.externalProvider || body.provider)
  const externalVmId = text(body.externalVmId || body.externalVMID || body.externalId)
  const hostname = text(body[`${prefix}Hostname`] || body.hostname)
  const ipAddress = text(body[`${prefix}Ip`] || body[`${prefix}IpAddress`] || body.ip || body.ipAddress)
  const username = text(body[`${prefix}Username`] || body.username)
  const password = String(body[`${prefix}Password`] || body.password || "")
  const port = numberOrNull(body[`${prefix}Port`] || body.port)
  const operatingSystem = text(body[`${prefix}OperatingSystem`] || body.operatingSystem || body.osName)
  const cpu = numberOrNull(body[`${prefix}Cpu`] || body.cpu)
  const ramGb = numberOrNull(body[`${prefix}RamGb`] || body[`${prefix}Ram`] || body.ramGb)
  const diskGb = numberOrNull(body[`${prefix}DiskGb`] || body[`${prefix}Disk`] || body.diskGb)
  const bandwidthTb = numberOrNull(body[`${prefix}BandwidthTb`] || body[`${prefix}Bandwidth`] || body.bandwidthTb)
  const location = text(body[`${prefix}Location`] || body.location)
  const notes = text(body[`${prefix}Notes`] || body.notes || body.adminNotes)

  return {
    mode,
    provider,
    externalVmId: external ? externalVmId : null,
    hostname,
    ipAddress,
    username,
    password,
    port,
    operatingSystem,
    cpu,
    ramGb,
    diskGb,
    bandwidthTb,
    location,
    notes,
  }
}

function validateDirectServicePayload(payload: ReturnType<typeof directServicePayload>) {
  const missing = [
    !payload.provider ? "provider" : null,
    payload.mode === "external_vm_attachment" && !payload.externalVmId ? "external VM ID" : null,
    !payload.hostname ? "hostname" : null,
    !payload.ipAddress ? "IP address" : null,
    !payload.username ? "username" : null,
    !payload.password ? "password" : null,
    !payload.operatingSystem ? "operating system" : null,
    !payload.cpu ? "CPU" : null,
    !payload.ramGb ? "RAM" : null,
    !payload.diskGb ? "disk" : null,
    !payload.bandwidthTb ? "bandwidth" : null,
  ].filter(Boolean)
  if (missing.length) return `${missing.join(", ")} required for ${payload.mode === "external_vm_attachment" ? "External VM Attachment" : "Manual Provision Complete"}`
  if (payload.password.length < 8) return "Password must be at least 8 characters"
  if (payload.mode === "manual_provision_complete" && payload.port !== null && (!Number.isInteger(payload.port) || payload.port <= 0 || payload.port > 65535)) {
    return "Port must be between 1 and 65535"
  }
  return null
}

async function createDirectVpsService(input: {
  order: any
  customer: any
  product: any
  operatingSystem: any
  payload: ReturnType<typeof directServicePayload>
  termMonths: number
  actorEmail: string
  passwordEncrypted: string | null
  serviceCreatedAt?: Date | null
  serviceDueAt?: Date | null
}) {
  const createdAt = input.serviceCreatedAt || new Date()
  const dates = lifecycleDates({
    orderCreatedAt: createdAt,
    termMonths: Math.max(1, Number(input.termMonths || 1)),
    renewalDueAt: input.serviceDueAt || null,
    graceDays: 2,
    retentionDays: 7,
  })
  const source = input.payload.mode === "external_vm_attachment" ? "external" : "manual_complete"
  const ownershipStatus = input.payload.mode === "external_vm_attachment" ? "external" : "manual"
  const vps = await (prisma as any).vpsInstance.create({
    data: {
      customerId: input.customer.id,
      orderId: input.order.id,
      productId: input.order.productId || null,
      nodeClassId: input.order.nodeClassId || null,
      storagePoolId: input.order.storagePoolId || null,
      proxmoxNodeId: null,
      operatingSystemId: input.order.operatingSystemId || null,
      vmid: 0,
      provisionMode: source,
      provisioningSource: source,
      ownershipStatus,
      ownershipVerifiedAt: new Date(),
      ownershipEvidence: {
        createdAt: new Date().toISOString(),
        actor: input.actorEmail,
        provider: input.payload.provider,
        externalVmId: input.payload.externalVmId,
        noProxmoxRequired: true,
      },
      serviceProvider: input.payload.provider,
      externalVmId: input.payload.externalVmId,
      serviceLocation: input.payload.location || null,
      name: input.payload.hostname,
      status: "ACTIVE",
      ipAddress: input.payload.ipAddress,
      username: input.payload.username,
      adminUsername: input.payload.username,
      passwordEncrypted: input.passwordEncrypted,
      accessMethod: "PASSWORD",
      cpuCores: input.payload.cpu || input.product?.cpuCores || null,
      ramGb: input.payload.ramGb || input.product?.ramGb || null,
      diskGb: input.payload.diskGb || input.product?.storageGb || null,
      bandwidthTb: input.payload.bandwidthTb || input.product?.bandwidthTb || null,
      billingCycle: billingCycleForTerm(input.termMonths),
      billingTermMonths: input.termMonths,
      activatedAt: createdAt,
      renewalDueAt: dates.renewalDueAt,
      nextRenewalAt: dates.renewalDueAt,
      suspendAt: dates.suspendAt,
      penaltyAt: dates.penaltyAt,
      terminationAt: dates.terminationAt,
      deletionAt: dates.deletionAt,
      manualCreatedDateOverride: Boolean(input.serviceCreatedAt),
      manualExpiryOverride: Boolean(input.serviceDueAt),
      createdAtManual: input.serviceCreatedAt || null,
      activatedAtManual: input.serviceCreatedAt || null,
      renewalAtManual: input.serviceDueAt ? dates.renewalDueAt : null,
      consoleEnabled: false,
      consoleType: "none",
      lifecycleMetadata: {
        noProxmoxRequired: true,
        provisionMode: source,
        provider: input.payload.provider,
        externalVmId: input.payload.externalVmId,
        location: input.payload.location || null,
        port: input.payload.port,
        notes: input.payload.notes || null,
      },
    },
  })
  await persistVpsConsoleMetadata({ vpsId: vps.id, osTemplateId: input.order.operatingSystemId || null }).catch(() => null)
  await prisma.order.update({
    where: { id: input.order.id },
    data: {
      serviceId: vps.id,
      vmId: 0,
      proxmoxNodeId: null,
      proxmoxNode: null,
      hostname: input.payload.hostname,
      adminUsername: input.payload.username,
      passwordEncrypted: input.passwordEncrypted,
      osName: input.payload.operatingSystem || input.operatingSystem?.name || input.order.osName || null,
      provisioningStatus: "ACTIVE",
      provisioningError: null,
      provisionedAt: new Date(),
      status: "active",
      metadata: {
        ...((input.order.metadata && typeof input.order.metadata === "object" && !Array.isArray(input.order.metadata)) ? input.order.metadata as Record<string, unknown> : {}),
        provisionMode: source,
        noProxmoxRequired: true,
        directService: {
          mode: input.payload.mode,
          provider: input.payload.provider,
          externalVmId: input.payload.externalVmId,
          location: input.payload.location || null,
          ipAddress: input.payload.ipAddress,
          port: input.payload.port,
          notes: input.payload.notes || null,
          createdBy: input.actorEmail,
          createdAt: new Date().toISOString(),
        },
      },
    },
  })
  await createPanelLog({
    category: "Provisioning",
    message: input.payload.mode === "external_vm_attachment" ? "admin_external_vm_attached" : "admin_manual_provision_completed",
    actorType: "admin",
    actorEmail: input.actorEmail,
    customerId: input.customer.id,
    orderId: input.order.id,
    vpsInstanceId: vps.id,
    vmid: 0,
    metadata: { provider: input.payload.provider, externalVmId: input.payload.externalVmId, ipAddress: input.payload.ipAddress },
  }).catch(() => null)
  return vps
}

export async function GET(request: NextRequest) {
  try {
    const admin = await getAdminFromCookies()
    if (!admin?.email) return apiError("unauthorized", "Unauthorized", 401)

    const status = request.nextUrl.searchParams.get("status")
    const includeDeleted = request.nextUrl.searchParams.get("includeDeleted") === "true"
    const search = String(request.nextUrl.searchParams.get("search") || "").trim()
    const page = Math.max(1, Number(request.nextUrl.searchParams.get("page") || 1))
    const pageSize = Math.min(100, Math.max(1, Number(request.nextUrl.searchParams.get("pageSize") || 50)))

    const where: any = {
      ...(status ? { status } : {}),
      ...(includeDeleted ? {} : { deletedAt: null }),
      ...(search ? {
        OR: [
          { orderNumber: { contains: search } },
          { customer: { OR: [{ email: { contains: search } }, { name: { contains: search } }] } },
        ],
      } : {}),
    }

    const [total, orders] = await Promise.all([
      prisma.order.count({ where }),
      prisma.order.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          customer: { select: { id: true, email: true, name: true } },
          product: { select: { id: true, name: true } },
          offer: { select: { id: true, name: true, slug: true } },
          operatingSystem: { select: { id: true, name: true, proxmoxVmid: true } },
          invoices: { select: { id: true, invoiceNumber: true, status: true } },
          vpsInstance: { select: { id: true, vmid: true, status: true, name: true } },
          dedicatedService: { select: { id: true, status: true, serviceNumber: true, primaryIp: true } },
          provisioningJobs: { select: { id: true, displayStatus: true, status: true, latestUpid: true, error: true }, orderBy: { createdAt: "desc" }, take: 1 },
          payments: { orderBy: { createdAt: "desc" }, take: 3 },
        },
      }),
    ])

    return apiSuccess({
      pagination: { page, pageSize, total, pages: Math.ceil(total / pageSize) },
      orders: orders.map((order) => ({
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        provisioningStatus: order.provisioningStatus,
        provisioningError: order.provisioningError,
        nodeId: order.proxmoxNodeId,
        proxmoxNodeId: order.proxmoxNodeId,
        deletedAt: order.deletedAt,
        unitPrice: money(order.unitPrice),
        subtotal: money(order.subtotal),
        taxAmount: money(order.taxAmount),
        discountAmount: money(order.discountAmount),
        totalAmount: money(order.totalAmount),
        payableAmount: money(order.payableAmount ?? order.finalAmount ?? order.totalAmount),
        createdAt: order.createdAt,
        customer: order.customer || null,
        product: order.product || null,
        offer: order.offer || null,
        operatingSystem: order.operatingSystem || null,
        invoices: order.invoices || [],
        vpsInstance: order.vpsInstance || null,
        dedicatedService: order.dedicatedService || null,
        provisioningJobs: order.provisioningJobs || [],
        payments: (order.payments || []).map((payment) => ({
          id: payment.id,
          status: payment.status,
          gateway: payment.gateway,
          gatewayOrderId: payment.gatewayOrderId,
          gatewayPaymentId: payment.gatewayPaymentId,
          transactionId: payment.gatewayTransactionId || payment.transactionId || payment.gatewayPaymentId || null,
          verified: ["completed", "paid", "success"].includes(String(payment.status || "").toLowerCase()) && Boolean(payment.completedAt || payment.webhookProcessedAt),
          verifiedAt: payment.completedAt || payment.webhookProcessedAt || null,
          gatewayResponseStatus: typeof payment.gatewayResponse === "object" && payment.gatewayResponse && !Array.isArray(payment.gatewayResponse)
            ? String((payment.gatewayResponse as any).status || (payment.gatewayResponse as any).code || (payment.gatewayResponse as any).eventType || "")
            : null,
          amount: money(payment.amount),
          walletAppliedAmount: money(payment.walletAppliedAmount),
          gatewayAmount: money(payment.gatewayAmount),
          createdAt: payment.createdAt,
        })),
      })),
    })
  } catch (error: any) {
    console.error("[ADMIN_ORDERS_GET]", error)
    return apiError("server_error", error?.message || "Unable to load orders", 500)
  }
}

export async function POST(request: NextRequest) {
  try {
    const admin = await getAdminFromCookies()
    if (!admin?.email || !canAccessAdminApi(admin.role)) {
      return apiError("unauthorized", "Unauthorized", 401)
    }

    const body = await request.json().catch(() => ({}))
    const customerId = String(body.customerId || "").trim()
    const productId = String(body.productId || "").trim()
    const offerId = String(body.offerId || "").trim()
    const operatingSystemId = String(body.operatingSystemId || "").trim()
    const termMonths = Number(body.termMonths || body.term || 1)
    const accessMethod = String(body.accessMethod || "PASSWORD").toUpperCase()
    const orderAction = String(body.orderAction || body.statusAction || "request_payment")
    const adminNotes = String(body.adminNotes || "").trim()
    const customerNotes = String(body.customerNotes || "").trim()
    const manualDiscountAmount = Math.max(0, Number(body.discountAmount || 0))
    const quantity = normalizeOrderQuantity(body.quantity)
    const provisioningMode = normalizeAdminProvisioningMode(body.provisioningMode || body.provisionMode || "auto_provision")
    const directService = provisioningMode === "external_vm_attachment" || provisioningMode === "manual_provision_complete"
    const directPayload = directService ? directServicePayload(body, provisioningMode) : null
    const inputPassword = String(directPayload?.password || body.password || "")
    const nodeSelection = String(body.nodeId || body.proxmoxNodeId || "product_default").trim()
    const linkExisting = provisioningMode === "link_existing_vm"
    const linkedNodeId = String(body.linkedNodeId || body.linkNodeId || body.existingNodeId || body.nodeId || body.proxmoxNodeId || "").trim()
    const linkedVmid = Number(body.linkedVmid || body.vmid || body.vmId || 0)
    const linkedServiceCreatedAt = parseAdminDateInput(body.linkedServiceCreatedAt || body.serviceCreatedAt || body.createdDate)
    const linkedServiceDueAt = parseAdminDateInput(body.linkedServiceDueAt || body.serviceDueAt || body.dueDate)
    const directServiceCreatedAt = parseAdminDateInput(body.serviceCreatedAt || body.createdDate || body.directServiceCreatedAt)
    const directServiceDueAt = parseAdminDateInput(body.serviceDueAt || body.dueDate || body.directServiceDueAt)
    const ipAssignmentMode = String(body.ipAssignmentMode || (body.requestedIp ? "manual" : "automatic")).trim().toLowerCase()
    const requestedIp = String(body.requestedIp || "").trim()
    const requestedPoolId = String(body.poolId || "").trim()
    const forceIpOverride = body.forceIpOverride === true

    if (!customerId || (!productId && !offerId)) return apiError("invalid_request", "Customer and product or offer are required", 400)
    if (![1, 3, 6, 12, 24, 36].includes(termMonths)) return apiError("invalid_term", "Invalid billing term", 400)
    if (Number(body.quantity || 1) !== quantity) return apiError("invalid_quantity", "Quantity must be between 1 and 100", 400)
    if ((linkExisting || directService) && quantity !== 1) return apiError("single_service_quantity", "This provision method supports one VM per order", 400)
    if (linkExisting && (!linkedNodeId || !Number.isInteger(linkedVmid) || linkedVmid <= 0)) return apiError("linked_vm_required", "Node and VMID are required to link an existing VM", 400)
    if (linkExisting && linkedServiceCreatedAt.error) return apiError("invalid_service_created_date", linkedServiceCreatedAt.error, 400)
    if (linkExisting && linkedServiceDueAt.error) return apiError("invalid_service_due_date", linkedServiceDueAt.error, 400)
    if (directService && directServiceCreatedAt.error) return apiError("invalid_service_created_date", directServiceCreatedAt.error, 400)
    if (directService && directServiceDueAt.error) return apiError("invalid_service_due_date", directServiceDueAt.error, 400)
    if (directPayload) {
      const directError = validateDirectServicePayload(directPayload)
      if (directError) return apiError("invalid_direct_service", directError, 400)
    }
    if (inputPassword && inputPassword.length < 8) return apiError("invalid_password", "Password must be at least 8 characters", 400)
    if (ipAssignmentMode === "manual") {
      if (!requestedPoolId || !requestedIp) return apiError("manual_ip_required", "Choose an IP pool and available IP for manual assignment", 400)
      if (quantity > 1) return apiError("manual_ip_quantity", "Manual IP selection is available for one VM at a time", 400)
    }

    const [customer, product, offer, operatingSystem] = await Promise.all([
      prisma.customer.findUnique({ where: { id: customerId } }),
      productId ? prisma.product.findUnique({ where: { id: productId } }) : null,
      offerId ? prisma.offer.findUnique({ where: { id: offerId }, include: { nodeClassRef: true, proxmoxNodeStoragePool: true } }) : null,
      operatingSystemId ? prisma.osTemplate.findUnique({ where: { id: operatingSystemId }, include: { proxmoxNode: true } }) : null,
    ])
    if (!customer) return apiError("customer_missing", "Customer not found", 404)
    if (!product && !offer) return apiError("product_missing", "Product or offer not found", 404)
    if (offer) {
      const availability = offerAvailability(offer)
      if (!availability.available) return apiError("offer_unavailable", availability.reason || "Offer is no longer available.", 400)
      const allowedTerms = Array.isArray(offer.billingTermsAllowed) ? offer.billingTermsAllowed.map((item) => Number(item)) : [1]
      if (!allowedTerms.includes(termMonths)) return apiError("invalid_term", "This offer is not available for the selected billing term.", 400)
    }

    let selectedNodeId: string | null = null
    if (nodeSelection && !["auto", "product_default"].includes(nodeSelection)) {
      const node = await prisma.proxmoxNode.findFirst({ where: { id: nodeSelection, isActive: true }, select: { id: true } })
      if (!node) return apiError("invalid_node", "Selected provision node is unavailable or inactive", 400)
      selectedNodeId = node.id
    } else if (nodeSelection === "product_default" && product?.defaultNodeId) {
      selectedNodeId = product.defaultNodeId
    }

    const preview = calculateAdminOrderPreview({
      provisioningMode,
      termMonths,
      quantity,
      discountAmount: manualDiscountAmount,
      backupEnabled: body.backupEnabled,
      snapshotCount: body.snapshotCount,
      ipv4Count: body.ipv4Count,
      product,
      offer,
      operatingSystem,
      selectedNode: selectedNodeId ? { id: selectedNodeId } : null,
      external: directPayload || null,
      manual: directPayload || null,
    })
    const unitPrice = preview.unitPrice
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) return apiError("invalid_price", "Product price is invalid", 400)
    const pricing = preview.pricing
    const perVmDiscount = quantity > 0 ? Number((pricing.discountAmount / quantity).toFixed(2)) : 0
    const bulkGroupId = quantity > 1 ? generateBulkGroupId("admin_order") : null
    const offerSnapshot = offer ? snapshotOffer(offer) : null

    const planName = offer?.name || product?.name || "plan"
    const customerName = customer.name || customer.email || "client"
    const prefix = `zws.${planHostnameSlug(planName)}.${customerHostnameSlug(customerName)}-`
    const existingHostnames = await prisma.order.count({
      where: { customerId, hostname: { startsWith: prefix }, deletedAt: null },
    }).catch(() => 0)
    const hostnames = directPayload?.hostname
      ? [directPayload.hostname]
      : generateVmHostnames({ planName, customerName, quantity, startAt: existingHostnames + 1 })
    for (const generatedHostname of hostnames) {
      if (!isValidLinuxHostname(generatedHostname)) return apiError("invalid_hostname", `Generated hostname is invalid: ${generatedHostname}`, 400)
    }

    const sharedPassword = directService || accessMethod.includes("PASSWORD") ? (inputPassword || generateRandomPassword()) : ""
    let passwordEncrypted: string | null = null
    let sshPublicKey: string | null = null
    let sshKeyId: string | null = body.sshKeyId ? String(body.sshKeyId) : null
    if (directService || accessMethod.includes("PASSWORD")) {
      passwordEncrypted = encryptSecret(sharedPassword)
    }
    if (accessMethod.includes("SSH") && body.sshPublicKey) {
      const parsed = parseSshPublicKey(String(body.sshPublicKey))
      sshPublicKey = parsed.publicKey
      if (body.saveSshKey) {
        const existing = await prisma.sshKey.findFirst({ where: { customerId, fingerprint: parsed.fingerprint } })
        sshKeyId = existing?.id || (await prisma.sshKey.create({
          data: {
            customerId,
            label: String(body.sshKeyLabel || "Admin uploaded key"),
            publicKey: parsed.publicKey,
            fingerprint: parsed.fingerprint,
            type: parsed.type,
            source: "uploaded",
          },
        })).id
      }
    }

    const shouldActivate = orderAction === "paid_activate"
    const draftOnly = orderAction === "draft_invoice"
    const autoProvision = await resolveAutoProvisionForProduct(product)
    const created: Array<{ order: any; invoice: any; credential: any }> = []
    const osText = `${operatingSystem?.name || ""} ${(operatingSystem as any)?.osType || ""} ${(operatingSystem as any)?.category || ""}`
    const adminUsername = /windows/i.test(osText) ? "Administrator" : "root"
    if (linkExisting) {
      const preview = await loadExistingVmPreview({ nodeId: linkedNodeId, vmid: linkedVmid })
      if (!preview.validation?.ok) {
        const code = preview.assigned ? "linked_vm_assigned" : "linked_vm_validation_failed"
        const status = preview.assigned ? 409 : 400
        return apiError(code, preview.validation?.error || "Existing VM validation failed", status)
      }
      if (preview.assigned) return apiError("linked_vm_assigned", `VM is already assigned to ${preview.assigned.customer} (${preview.assigned.order})`, 409)
    } else if (!directService) {
      const preflight = await validateProvisioningPreflight({
        nodeId: selectedNodeId,
        vcpu: Number(offer?.vcpu || product?.cpuCores || 1),
        ramGb: Number(offer?.ramGb || product?.ramGb || 1),
        storageGb: Number(offer?.storageGb || product?.storageGb || 20),
        productId: product?.id || null,
        bandwidthTb: Number(offer?.bandwidthTb || product?.bandwidthTb || 0),
        osFamily: (operatingSystem as any)?.osFamily || (operatingSystem as any)?.category || null,
        osVersion: (operatingSystem as any)?.osVersion || operatingSystem?.name || null,
        osTemplateId: operatingSystem?.id || null,
        nodeClassId: offer?.nodeClassId || null,
        storagePoolId: offer?.storagePoolId || null,
        allowStorageFallback: true,
        poolId: requestedPoolId || null,
        requestedIp: ipAssignmentMode === "manual" || requestedIp ? requestedIp || null : null,
        forceIpOverride,
      })
      if (!preflight.ok) {
        return apiError(String(preflight.errorCode || "provisioning_preflight_failed"), preflight.reason || "Provisioning preflight failed", 400)
      }
    }

    for (const [index, hostname] of hostnames.entries()) {
      const orderNumber = generateOrderNumber()
      const subtotal = unitPrice
      const discountAmount = perVmDiscount
      const taxAmount = Number((Math.max(0, subtotal - discountAmount) * (Number(preview.pricingSnapshot.taxPercent || 0) / 100)).toFixed(2))
      const totalAmount = Math.max(0, Number((subtotal + taxAmount - discountAmount).toFixed(2)))
      const customConfig = offer ? await prisma.customConfig.create({
        data: {
          customerId,
          cpuCores: offer.vcpu,
          ramGb: offer.ramGb,
          disks: [{ type: offer.storageTier || "nvme", sizeGb: offer.storageGb, label: "Offer storage" }],
          bandwidthTb: offer.bandwidthTb,
          termMonths,
          monthlyPrice: unitPrice,
          totalPrice: subtotal,
          status: "draft",
        },
      }) : null

      const order = await prisma.order.create({
      data: {
        orderNumber,
        customerId,
        productId: product?.id || null,
        offerId: offer?.id || null,
        offerSnapshot: offerSnapshot || undefined,
        customConfigId: customConfig?.id || undefined,
        nodeClassId: offer?.nodeClassId || undefined,
        nodeClassSnapshot: offer?.nodeClassRef ? { id: offer.nodeClassRef.id, name: offer.nodeClassRef.name, slug: offer.nodeClassRef.slug, publicLabel: offer.nodeClassRef.publicLabel } : undefined,
        storagePoolId: offer?.storagePoolId || undefined,
        storagePoolSnapshot: offer?.proxmoxNodeStoragePool ? { id: offer.proxmoxNodeStoragePool.id, storageId: offer.proxmoxNodeStoragePool.storageId, displayName: offer.proxmoxNodeStoragePool.displayName || offer.proxmoxNodeStoragePool.storageId, premium: offer.proxmoxNodeStoragePool.premium } : undefined,
        termMonths,
        unitPrice,
        quantity: 1,
        subtotal,
        taxAmount,
        discountAmount,
        totalAmount,
        originalAmount: subtotal + taxAmount,
        finalAmount: totalAmount,
        payableAmount: totalAmount,
        operatingSystemId: operatingSystem?.id || null,
        osName: directPayload?.operatingSystem || operatingSystem?.name || null,
        templateVmid: operatingSystem?.proxmoxVmid || null,
        proxmoxNodeId: directService ? null : selectedNodeId,
        hostname: hostname || null,
        adminUsername: directPayload?.username || adminUsername,
        accessMethod,
        passwordEncrypted,
        sshPublicKey,
        sshKeyId,
        currency: "INR",
        status: directService ? "active" : shouldActivate ? "paid" : draftOnly ? "draft" : "pending",
        notes: adminNotes || null,
        metadata: {
          createdByAdmin: admin.email,
          customerNotes: customerNotes || null,
          adminOrderAction: orderAction,
          productName: offer?.name || product?.name,
          bulkGroupId,
          bulkIndex: index + 1,
          bulkQuantity: quantity,
          bulkDiscountPercent: pricing.bulkDiscountPercent,
          bulkDiscountAmount: hasBulkDiscount(quantity) ? perVmDiscount : 0,
          generatedHostname: hostname,
          provisionNodeSelection: nodeSelection || "product_default",
          provisionNodeId: linkExisting ? linkedNodeId : selectedNodeId,
          provisionMode: directService ? (provisioningMode === "external_vm_attachment" ? "external" : "manual_complete") : linkExisting ? "linked" : "created",
          linkedExistingVm: linkExisting ? { nodeId: linkedNodeId, vmid: linkedVmid } : null,
          directService: directPayload ? {
            mode: provisioningMode,
            provider: directPayload.provider,
            externalVmId: directPayload.externalVmId,
            ipAddress: directPayload.ipAddress,
            port: directPayload.port,
            location: directPayload.location,
          } : null,
          autoProvisionEffective: linkExisting || directService ? false : autoProvision.enabled,
          autoProvisionSource: autoProvision.source,
          pricingSnapshot: {
            ...preview.pricingSnapshot,
            subtotal,
            discount: discountAmount,
            taxableAmount: Math.max(0, Number((subtotal - discountAmount).toFixed(2))),
            gst: taxAmount,
            total: totalAmount,
          },
          ipAssignment: {
            mode: ipAssignmentMode === "manual" ? "manual" : "automatic",
            poolId: requestedPoolId || null,
            requestedIp: requestedIp || null,
            forceIpOverride,
          },
        },
      },
      })

      let invoice: any = null
      if (linkExisting) {
        try {
          invoice = await createInvoiceForOrder(order.id)
          if (shouldActivate) {
            const payment = await prisma.payment.create({
              data: {
                orderId: order.id,
                invoiceId: invoice.id,
                customerId,
                gateway: "manual",
                amount: totalAmount,
                currency: "INR",
                status: "completed",
                purpose: "admin_link_existing_vm",
                completedAt: new Date(),
                gatewayTransactionId: `manual-linked:${order.orderNumber}`,
                transactionId: `manual-linked:${order.orderNumber}`,
                errorMessage: "Marked paid by admin while linking existing VM",
              },
            })
            invoice = await prisma.invoice.update({
              where: { id: invoice.id },
              data: {
                status: "paid",
                paidAt: new Date(),
                manualProcessedBy: String(admin.email),
                manualProcessedAt: new Date(),
                manualReason: "Linked existing VM",
                paymentTransactionId: payment.transactionId || payment.gatewayTransactionId || payment.id,
              },
            }).catch(() => invoice)
          }
          const linked = await bindExistingVmToOrder({
            orderId: order.id,
            customerId,
            nodeId: linkedNodeId,
            vmid: linkedVmid,
            actorEmail: String(admin.email),
            source: "linked",
            reason: adminNotes || "Admin linked existing VM during order creation",
            serviceCreatedAt: linkedServiceCreatedAt.date,
            serviceDueAt: linkedServiceDueAt.date,
          })
          created.push({
            order: { ...order, serviceId: linked.vpsId, vmId: linked.vmid, proxmoxNodeId: linkedNodeId, status: "active", provisioningStatus: "ACTIVE" },
            invoice,
            credential: {
              orderId: order.id,
              orderNumber: order.orderNumber,
              hostname: hostname,
              ip: linked.ipAddress || null,
              username: adminUsername,
              password: sharedPassword,
              os: operatingSystem?.name || null,
            },
          })
          continue
        } catch (error) {
          await prisma.payment.deleteMany({ where: { orderId: order.id } }).catch(() => null)
          await prisma.invoice.deleteMany({ where: { orderId: order.id } }).catch(() => null)
          await prisma.order.delete({ where: { id: order.id } }).catch(() => null)
          if (customConfig) await prisma.customConfig.delete({ where: { id: customConfig.id } }).catch(() => null)
          throw error
        }
      }

      if (directService && directPayload) {
        try {
          invoice = await createInvoiceForOrder(order.id)
          const payment = await prisma.payment.create({
            data: {
              orderId: order.id,
              invoiceId: invoice.id,
              customerId,
              gateway: "manual",
              amount: totalAmount,
              currency: "INR",
              status: "completed",
              purpose: provisioningMode === "external_vm_attachment" ? "admin_external_vm_attachment" : "admin_manual_provision_complete",
              completedAt: new Date(),
              gatewayTransactionId: `manual-direct:${order.orderNumber}`,
              transactionId: `manual-direct:${order.orderNumber}`,
              errorMessage: provisioningMode === "external_vm_attachment" ? "External VM attached by admin" : "Manual provision completed by admin",
            },
          })
          invoice = await prisma.invoice.update({
            where: { id: invoice.id },
            data: {
              status: "paid",
              paidAt: new Date(),
              manualProcessedBy: String(admin.email),
              manualProcessedAt: new Date(),
              manualReason: provisioningMode === "external_vm_attachment" ? "External VM attachment" : "Manual provision complete",
              paymentTransactionId: payment.transactionId || payment.gatewayTransactionId || payment.id,
            },
          }).catch(() => invoice)
          const service = await createDirectVpsService({
            order,
            customer,
            product,
            operatingSystem,
            payload: directPayload,
            termMonths,
            actorEmail: String(admin.email),
            passwordEncrypted,
            serviceCreatedAt: directServiceCreatedAt.date,
            serviceDueAt: directServiceDueAt.date,
          })
          created.push({
            order: { ...order, serviceId: service.id, vmId: 0, status: "active", provisioningStatus: "ACTIVE", hostname: directPayload.hostname },
            invoice,
            credential: {
              orderId: order.id,
              orderNumber: order.orderNumber,
              hostname: directPayload.hostname,
              ip: directPayload.ipAddress,
              username: directPayload.username,
              password: directPayload.password,
              os: directPayload.operatingSystem || operatingSystem?.name || null,
            },
          })
          continue
        } catch (error) {
          await prisma.payment.deleteMany({ where: { orderId: order.id } }).catch(() => null)
          await prisma.invoice.deleteMany({ where: { orderId: order.id } }).catch(() => null)
          await (prisma as any).vpsInstance.deleteMany({ where: { orderId: order.id } }).catch(() => null)
          await prisma.order.delete({ where: { id: order.id } }).catch(() => null)
          if (customConfig) await prisma.customConfig.delete({ where: { id: customConfig.id } }).catch(() => null)
          throw error
        }
      }

      if (shouldActivate) {
        invoice = await createInvoiceForOrder(order.id)
        const payment = await prisma.payment.create({
          data: {
            orderId: order.id,
            invoiceId: invoice.id,
            customerId,
            gateway: "manual",
            amount: totalAmount,
            currency: "INR",
            status: "completed",
            purpose: "admin_created_order",
            completedAt: new Date(),
            gatewayTransactionId: `manual:${order.orderNumber}`,
            transactionId: `manual:${order.orderNumber}`,
            errorMessage: "Marked paid by admin during order creation",
          },
        })
        await handlePaidInvoice(invoice.id, {
          paymentId: payment.id,
          actor: `admin:${admin.email}`,
          autoProvision: autoProvision.enabled,
          purpose: "admin_created_order",
          transactionId: `manual:${order.orderNumber}`,
        })
        if (!autoProvision.enabled) {
          await prisma.order.update({
            where: { id: order.id },
            data: {
              provisioningStatus: "waiting_for_admin",
              provisioningError: null,
              metadata: {
                ...((order.metadata && typeof order.metadata === "object" && !Array.isArray(order.metadata)) ? order.metadata as Record<string, unknown> : {}),
                autoProvisionEffective: false,
                autoProvisionSource: autoProvision.source,
                waitingForManualProvisioningAt: new Date().toISOString(),
              },
            },
          }).catch(() => undefined)
        }
        await prisma.provisioningJob.updateMany({
          where: { orderId: order.id, status: { in: ["queued", "waiting_for_admin"] } },
          data: {
            metadata: {
              actor: `admin:${admin.email}`,
              ipAssignment: {
                mode: ipAssignmentMode === "manual" ? "manual" : "automatic",
                poolId: requestedPoolId || null,
                requestedIp: requestedIp || null,
                forceIpOverride,
              },
            },
          },
        }).catch(() => undefined)
      } else {
        const now = new Date()
        const dueDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
        invoice = await prisma.invoice.create({
          data: {
            invoiceNumber: invoiceNumberFor(order.orderNumber),
            orderId: order.id,
            customerId,
            issueDate: now,
            dueDate,
            subtotal,
            ...invoiceTaxWriteFields({ taxRate: preview.pricingSnapshot.taxPercent, taxAmount }),
            discountAmount,
            totalAmount,
            currency: "INR",
            status: draftOnly ? "draft" : "unpaid",
            type: "service",
            lineItems: [{ description: offer?.name || product?.name || "Cloud Instance", quantity: 1, unitPrice: subtotal, termMonths, total: subtotal, osName: operatingSystem?.name || null }],
            notes: customerNotes || null,
            metadata: {
              invoiceType: draftOnly ? "proforma" : "tax_invoice",
              createdByAdmin: admin.email,
              bulkGroupId,
              bulkIndex: index + 1,
              bulkQuantity: quantity,
              pricingSnapshot: {
                ...preview.pricingSnapshot,
                subtotal,
                discount: discountAmount,
                taxableAmount: Math.max(0, Number((subtotal - discountAmount).toFixed(2))),
                gst: taxAmount,
                total: totalAmount,
              },
            },
          },
        })
      }

      created.push({
        order,
        invoice,
        credential: {
          orderId: order.id,
          orderNumber: order.orderNumber,
          hostname,
          ip: null,
          username: adminUsername,
          password: sharedPassword,
          os: operatingSystem?.name || null,
        },
      })
    }

    if (offer) await prisma.offer.update({ where: { id: offer.id }, data: { purchasesCount: { increment: quantity } } }).catch(() => undefined)

    await createPanelLog({
      category: "Admin Action",
      message: "admin_order_created",
      actorType: "admin",
      actorEmail: admin.email,
      customerId,
      orderId: created[0]?.order?.id || null,
      metadata: { orderAction, invoiceId: created[0]?.invoice?.id || null, bulkGroupId, quantity },
    })
    await writeAuditLog({ action: "admin_manual_order_created", actorEmail: String(admin.email), customerId, targetType: "order", targetId: created[0]?.order?.id || "bulk", metadata: { orderAction, offerId: offer?.id || null, productId: product?.id || null, bulkGroupId, quantity } })

    return apiSuccess({
      success: true,
      order: created[0]?.order || null,
      invoice: created[0]?.invoice || null,
      orders: created.map((item) => item.order),
      invoices: created.map((item) => item.invoice),
      credentials: created.map((item) => item.credential),
      pricing,
      bulkGroupId,
      quantity,
      redirectTo: quantity > 1 && bulkGroupId
        ? `/admin/orders?search=${encodeURIComponent(bulkGroupId)}&focusBulk=${encodeURIComponent(bulkGroupId)}`
        : created[0]?.order?.id
          ? `/admin/orders?search=${encodeURIComponent(created[0].order.orderNumber)}&focus=${encodeURIComponent(created[0].order.id)}`
          : "/admin/orders",
      autoProvisionEffective: autoProvision.enabled,
      autoProvisionSource: autoProvision.source,
    }, 201)
  } catch (error: any) {
    console.error("[ADMIN_ORDERS_POST]", error)
    return apiError("server_error", error?.message || "Unable to create order", 500)
  }
}
