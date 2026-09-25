import { prisma } from "@/lib/db"
import { createPanelLog } from "@/lib/panel-log"
import { decryptSecretValue, encryptSecretValue } from "@/lib/secret-crypto"
import { sendTemplateEmail } from "@/lib/email/send-mail"
import { getSiteUrl } from "@/lib/settings/site-settings"

export const DEDICATED_TERMS = [1, 3, 6, 12, 24, 36] as const
export const DEDICATED_PAYMENT_PENDING = "pending_payment"
export const DEDICATED_WAITING_INSTALL = "paid_waiting_installation"
export const DEDICATED_INSTALLING = "installing"
export const DEDICATED_DELIVERED = "delivered"
export const DEDICATED_CANCELLED = "cancelled"
export const DEDICATED_REFUNDED = "refunded"

export type DedicatedProductSettings = {
  deliverySlaHours: number
  bandwidthLabel: string
  location: string
  setupFee: number
  purchaseEnabled: boolean
  whatsappEnabled: boolean
  allowCustomOsRequest: boolean
  selectableOsOptionIds: string[]
}

export const DEFAULT_DEDICATED_OS_OPTIONS = [
  { family: "linux", familyLabel: "Linux", name: "Ubuntu", version: "22.04 / 24.04", slug: "ubuntu", iconUrl: "/os-icons/ubuntu.svg", defaultUsername: "root", isRecommended: true, sortOrder: 10 },
  { family: "linux", familyLabel: "Linux", name: "Debian", version: "12", slug: "debian", iconUrl: "/os-icons/debian.svg", defaultUsername: "root", isRecommended: true, sortOrder: 20 },
  { family: "linux", familyLabel: "Linux", name: "AlmaLinux", version: "8 / 9", slug: "almalinux", iconUrl: "/os-icons/almalinux.svg", defaultUsername: "root", isRecommended: true, sortOrder: 30 },
  { family: "linux", familyLabel: "Linux", name: "Rocky Linux", version: "8 / 9", slug: "rocky-linux", iconUrl: "/os-icons/rocky.svg", defaultUsername: "root", isRecommended: true, sortOrder: 40 },
  { family: "linux", familyLabel: "Linux", name: "CentOS", version: "7 / Stream", slug: "centos", iconUrl: "/os-icons/centos.svg", defaultUsername: "root", isRecommended: false, sortOrder: 50 },
  { family: "windows", familyLabel: "Windows Server", name: "Windows Server", version: "2019 / 2022 / 2025", slug: "windows-server", iconUrl: "/os-icons/windows.svg", defaultUsername: "Administrator", isRecommended: true, sortOrder: 60 },
  { family: "virtualization", familyLabel: "Virtualization", name: "Proxmox VE", version: "8", slug: "proxmox-ve", iconUrl: "/os-icons/linux.svg", defaultUsername: "root", isRecommended: true, sortOrder: 70 },
  { family: "virtualization", familyLabel: "Virtualization", name: "VMware ESXi", version: "7 / 8", slug: "vmware-esxi", iconUrl: "/os-icons/linux.svg", defaultUsername: "root", isRecommended: false, sortOrder: 80 },
  { family: "virtualization", familyLabel: "Virtualization", name: "Virtualizor", version: null, slug: "virtualizor", iconUrl: "/os-icons/linux.svg", defaultUsername: "root", isRecommended: false, sortOrder: 90 },
  { family: "cloud-platform", familyLabel: "Cloud Platform", name: "OpenStack", version: null, slug: "openstack", iconUrl: "/os-icons/linux.svg", defaultUsername: "root", isRecommended: false, sortOrder: 100 },
]

export async function ensureDefaultDedicatedOsOptions() {
  const existing = await prisma.dedicatedOsOption.findMany({
    where: { slug: { in: DEFAULT_DEDICATED_OS_OPTIONS.map((option) => option.slug) } },
    select: { slug: true },
  })
  const existingSlugs = new Set(existing.map((row) => row.slug))
  const missing = DEFAULT_DEDICATED_OS_OPTIONS.filter((option) => !existingSlugs.has(option.slug))
  if (!missing.length) return { created: 0 }
  await prisma.$transaction(missing.map((option) => prisma.dedicatedOsOption.create({
    data: {
      ...option,
      isActive: true,
      description: `${option.name} dedicated server installation option`,
      metadata: { seededBy: "production-hardening-defaults" },
    },
  })))
  return { created: missing.length }
}

function money(value: unknown) {
  const n = Number(value || 0)
  return Number.isFinite(n) ? Number(n.toFixed(2)) : 0
}

function addMonths(date: Date, months: number) {
  const next = new Date(date)
  next.setMonth(next.getMonth() + months)
  return next
}

function addHours(date: Date, hours: number) {
  return new Date(date.getTime() + Math.max(1, hours) * 60 * 60 * 1000)
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {}
}

export function dedicatedSettingsFromProduct(product: any): DedicatedProductSettings {
  const metadata = asRecord(product?.metadata)
  const dedicated = asRecord(metadata.dedicated)
  const features: string[] = Array.isArray(product?.features) ? product.features.map(String) : []
  const uplink = features.find((feature: string) => /mbps|gbps|uplink|bandwidth/i.test(feature)) || ""
  const regions = Array.isArray(product?.regions) ? product.regions : []
  const firstRegion = regions[0]
  const location = typeof firstRegion === "string" ? firstRegion : firstRegion?.name || firstRegion?.slug || "India"
  return {
    deliverySlaHours: Math.max(1, Number(dedicated.deliverySlaHours || 72)),
    bandwidthLabel: String(dedicated.bandwidthLabel || uplink || `${Number(product?.bandwidthTb || 0)} TB`),
    location: String(dedicated.location || location || "India"),
    setupFee: money(dedicated.setupFee),
    purchaseEnabled: dedicated.purchaseEnabled !== false,
    whatsappEnabled: dedicated.whatsappEnabled ?? product?.whatsappEnabled ?? true,
    allowCustomOsRequest: dedicated.allowCustomOsRequest !== false,
    selectableOsOptionIds: Array.isArray(dedicated.selectableOsOptionIds) ? dedicated.selectableOsOptionIds.map(String).filter(Boolean) : [],
  }
}

export function dedicatedServiceNumber(orderNumber: string) {
  return `DS-${String(orderNumber || "").replace(/^ZWS-/, "").replace(/[^a-zA-Z0-9-]/g, "")}`
}

export function cleanWhatsappPhone(value: string | null | undefined) {
  return String(value || "").replace(/[^\d]/g, "")
}

export function buildDedicatedWhatsappUrl(input: {
  phone: string
  productName: string
  price: number
  pageUrl: string
}) {
  const phone = cleanWhatsappPhone(input.phone)
  if (!phone) return null
  const message = [
    "Hi, I need help with a dedicated server.",
    `Product: ${input.productName}`,
    `Price: INR ${money(input.price).toLocaleString("en-IN")}/mo`,
    `Page: ${input.pageUrl}`,
  ].join("\n")
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`
}

export async function getDedicatedOsOptions(product?: any) {
  await ensureDefaultDedicatedOsOptions()
  const settings = product ? dedicatedSettingsFromProduct(product) : null
  const ids = settings?.selectableOsOptionIds || []
  const rows = await prisma.dedicatedOsOption.findMany({
    where: {
      isActive: true,
      ...(ids.length ? { id: { in: ids } } : {}),
    },
    orderBy: [{ sortOrder: "asc" }, { familyLabel: "asc" }, { name: "asc" }],
  })
  if (!settings || settings.allowCustomOsRequest || ids.length) return rows
  return rows.filter((row) => row.slug !== "custom-os-open-support-ticket")
}

export async function createPendingDedicatedServiceForOrder(input: {
  orderId: string
  customerId: string
  productId: string
  osOptionId?: string | null
  hostname?: string | null
  installationNotes?: string | null
  sshPublicKey?: string | null
  ipmiRequired?: boolean
  deliverySlaHours: number
}) {
  const [order, osOption] = await Promise.all([
    prisma.order.findUnique({ where: { id: input.orderId }, select: { orderNumber: true, termMonths: true, unitPrice: true } }),
    input.osOptionId ? prisma.dedicatedOsOption.findUnique({ where: { id: input.osOptionId } }) : null,
  ])
  if (!order) throw new Error("Order not found for dedicated service")
  return prisma.dedicatedService.upsert({
    where: { orderId: input.orderId },
    update: {
      productId: input.productId,
      dedicatedOsOptionId: osOption?.id || null,
      hostname: input.hostname || null,
      selectedOsFamily: osOption?.familyLabel || osOption?.family || null,
      selectedOsName: osOption?.name || null,
      installationNotes: input.installationNotes || null,
      sshPublicKey: input.sshPublicKey || null,
      ipmiRequired: Boolean(input.ipmiRequired),
      deliverySlaHours: input.deliverySlaHours,
      renewalAmount: money(order.unitPrice),
    },
    create: {
      customerId: input.customerId,
      orderId: input.orderId,
      productId: input.productId,
      dedicatedOsOptionId: osOption?.id || null,
      serviceNumber: dedicatedServiceNumber(order.orderNumber),
      hostname: input.hostname || null,
      status: DEDICATED_PAYMENT_PENDING,
      selectedOsFamily: osOption?.familyLabel || osOption?.family || null,
      selectedOsName: osOption?.name || null,
      installationNotes: input.installationNotes || null,
      sshPublicKey: input.sshPublicKey || null,
      ipmiRequired: Boolean(input.ipmiRequired),
      deliverySlaHours: input.deliverySlaHours,
      renewalAmount: money(order.unitPrice),
    },
  })
}

export async function markDedicatedPaymentConfirmed(orderId: string, actor = "system") {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { customer: true, product: true, dedicatedService: true, invoices: true },
  })
  if (!order || String(order.orderType || "").toLowerCase() !== "dedicated") return null
  if (!order.customerId || !order.productId) return null
  const settings = dedicatedSettingsFromProduct(order.product)
  const confirmedAt = order.dedicatedService?.paymentConfirmedAt || new Date()
  const estimatedDeliveryAt = order.dedicatedService?.estimatedDeliveryAt || addHours(confirmedAt, settings.deliverySlaHours)
  const service = await prisma.dedicatedService.upsert({
    where: { orderId },
    update: {
      status: DEDICATED_WAITING_INSTALL,
      paymentConfirmedAt: confirmedAt,
      estimatedDeliveryAt,
      deliverySlaHours: settings.deliverySlaHours,
      nextRenewalAt: order.dedicatedService?.nextRenewalAt || addMonths(confirmedAt, order.termMonths),
      renewalAmount: money(order.unitPrice),
    },
    create: {
      customerId: order.customerId,
      orderId,
      productId: order.productId,
      serviceNumber: dedicatedServiceNumber(order.orderNumber),
      status: DEDICATED_WAITING_INSTALL,
      paymentConfirmedAt: confirmedAt,
      estimatedDeliveryAt,
      deliverySlaHours: settings.deliverySlaHours,
      nextRenewalAt: addMonths(confirmedAt, order.termMonths),
      renewalAmount: money(order.unitPrice),
    },
  })
  await prisma.order.update({
    where: { id: orderId },
    data: {
      status: DEDICATED_WAITING_INSTALL,
      provisioningStatus: "WAITING_FOR_INSTALLATION",
      provisioningError: null,
      serviceId: service.id,
    },
  })
  await createPanelLog({
    category: "Admin Action",
    level: "info",
    message: "dedicated_payment_confirmed",
    customerId: order.customerId,
    orderId,
    metadata: { serviceId: service.id, actor, estimatedDeliveryAt },
  }).catch(() => null)
  await sendDedicatedEmail("dedicated_payment_confirmed", service.id, { source: actor }).catch(() => null)
  return service
}

export async function updateDedicatedStatus(serviceId: string, status: string, actor: string, metadata: Record<string, unknown> = {}) {
  const now = new Date()
  const data: Record<string, any> = { status }
  if (status === DEDICATED_INSTALLING) data.installingAt = now
  if (status === DEDICATED_CANCELLED) data.cancelledAt = now
  if (status === DEDICATED_REFUNDED) data.refundedAt = now
  const service = await prisma.dedicatedService.update({
    where: { id: serviceId },
    data,
    include: { order: true, customer: true, product: true },
  })
  const orderStatus = status === DEDICATED_INSTALLING ? DEDICATED_INSTALLING : status
  await prisma.order.update({
    where: { id: service.orderId },
    data: {
      status: orderStatus,
      provisioningStatus: status === DEDICATED_INSTALLING ? "INSTALLING" : status.toUpperCase(),
    },
  })
  await createPanelLog({
    category: "Admin Action",
    level: ["cancelled", "refunded"].includes(status) ? "warn" : "info",
    message: `dedicated_${status}`,
    customerId: service.customerId,
    orderId: service.orderId,
    metadata: { serviceId, actor, ...metadata },
  }).catch(() => null)
  const template = status === DEDICATED_INSTALLING ? "dedicated_installing" : status === DEDICATED_CANCELLED ? "dedicated_cancelled" : status === DEDICATED_REFUNDED ? "dedicated_refunded" : null
  if (template) await sendDedicatedEmail(template, service.id, { source: actor }).catch(() => null)
  return service
}

export async function deliverDedicatedService(serviceId: string, input: {
  primaryIp: string
  username: string
  password: string
  panelUrl?: string | null
  notes?: string | null
  installedOs?: string | null
  actor: string
}) {
  const service = await prisma.dedicatedService.update({
    where: { id: serviceId },
    data: {
      status: DEDICATED_DELIVERED,
      primaryIp: input.primaryIp,
      username: input.username,
      passwordEncrypted: encryptSecretValue(input.password),
      panelUrl: input.panelUrl || null,
      deliveryNotes: input.notes || null,
      installedOs: input.installedOs || null,
      deliveredAt: new Date(),
    },
    include: { order: true, customer: true, product: true },
  })
  await prisma.order.update({
    where: { id: service.orderId },
    data: {
      status: DEDICATED_DELIVERED,
      provisioningStatus: "ACTIVE",
      provisionedAt: service.deliveredAt || new Date(),
      serviceId: service.id,
    },
  })
  await createPanelLog({
    category: "Admin Action",
    level: "info",
    message: "dedicated_delivered",
    customerId: service.customerId,
    orderId: service.orderId,
    metadata: {
      serviceId,
      actor: input.actor,
      primaryIp: input.primaryIp,
      username: input.username,
      hasPassword: Boolean(input.password),
      panelUrl: input.panelUrl || null,
      installedOs: input.installedOs || null,
    },
  }).catch(() => null)
  await sendDedicatedEmail("dedicated_delivered", service.id, { temporaryPassword: input.password, source: input.actor }).catch(() => null)
  return service
}

export function decryptDedicatedPassword(value: string | null | undefined) {
  if (!value) return null
  try {
    return decryptSecretValue(value)
  } catch {
    return null
  }
}

export async function sendDedicatedEmail(templateKey: string, serviceId: string, metadata: Record<string, unknown> = {}) {
  const service = await prisma.dedicatedService.findUnique({
    where: { id: serviceId },
    include: { customer: true, product: true, order: { include: { invoices: true } } },
  })
  if (!service?.customer?.email) return null
  const invoice = service.order.invoices
  const appUrl = await getSiteUrl()
  const serviceUrl = `${appUrl}/client-area/dedicated/${service.id}`
  return sendTemplateEmail({
    templateKey,
    to: service.customer.email,
    variables: {
      userName: service.customer.name || "there",
      email: service.customer.email,
      orderId: service.order.orderNumber,
      invoiceNumber: invoice?.invoiceNumber || "",
      amount: money(service.order.payableAmount ?? service.order.finalAmount ?? service.order.totalAmount).toFixed(2),
      currency: service.order.currency || "INR",
      productName: service.product?.name || "Dedicated Server",
      serviceName: service.hostname || service.serviceNumber,
      serviceUrl,
      paymentUrl: invoice?.id ? `${appUrl}/client-area/billing/invoices/${invoice.id}` : `${appUrl}/client-area/billing`,
      deliverySlaHours: String(service.deliverySlaHours || 72),
      primaryIp: service.primaryIp || "",
      serverUsername: service.username || "",
      temporaryPassword: String(metadata.temporaryPassword || ""),
      panelUrl: service.panelUrl || "",
    },
    customerId: service.customerId,
    orderId: service.orderId,
    invoiceId: invoice?.id || null,
    metadata,
  })
}
