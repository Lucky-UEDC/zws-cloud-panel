import crypto from "node:crypto"
import { prisma } from "@/lib/db"
import { createPanelLog } from "@/lib/panel-log"
import { createProxmoxClient, PROXMOX_LONG_TIMEOUT_MS } from "@/lib/proxmox"
import { bucketStart, tbToBytes } from "@/lib/bandwidth-accounting"
import { sendNotification } from "@/lib/notifications/service"
import { WHATSAPP_TEMPLATE_KEYS } from "@/lib/whatsapp/template-registry"
import { withRedisLock } from "@/lib/redis"

export const DEFAULT_THROTTLE_MEGABITS_PER_SECOND = 0.5
export const DEFAULT_PROXMOX_RATE_MEGABYTES_PER_SECOND = 0.0625

function numberValue(value: unknown) {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function addMonths(date: Date, months: number) {
  const next = new Date(date)
  next.setUTCMonth(next.getUTCMonth() + months)
  return next
}

function splitNicConfig(value: string) {
  return String(value || "").split(",").map((part) => part.trim()).filter(Boolean)
}

export function proxmoxRateValueForMbps(mbps = DEFAULT_THROTTLE_MEGABITS_PER_SECOND) {
  return Number((Math.max(0, numberValue(mbps)) / 8).toFixed(4))
}

export function setNicRateLimit(net0: string, proxmoxRateValue: number | null) {
  const parts = splitNicConfig(net0).filter((part) => !part.toLowerCase().startsWith("rate="))
  const rate = numberValue(proxmoxRateValue)
  if (rate > 0) parts.push(`rate=${rate.toFixed(4).replace(/0+$/, "").replace(/\.$/, "")}`)
  return parts.join(",")
}

export function readNicRateLimit(net0: string) {
  const match = String(net0 || "").match(/(?:^|,)rate=([^,]+)/i)
  return match ? numberValue(match[1]) : null
}

async function monthlyUsageBytes(vpsId: string, at = new Date()) {
  const bucketAt = bucketStart("month", at)
  const row = await (prisma as any).bandwidthUsageRollup.findUnique({
    where: { scopeType_scopeId_period_bucketAt: { scopeType: "vps", scopeId: vpsId, period: "month", bucketAt } },
  }).catch(() => null)
  return BigInt(row?.totalBytes || 0)
}

function vpsCycle(vps: any, now = new Date()) {
  const cycleStartedAt = bucketStart("month", now)
  const cycleEndsAt = vps.renewalDueAt || vps.nextRenewalAt
    ? new Date(vps.renewalDueAt || vps.nextRenewalAt)
    : addMonths(cycleStartedAt, 1)
  return { cycleStartedAt, cycleEndsAt }
}

function bandwidthMessage(input: { serverName: string; totalGb: string; limitGb: string }) {
  return [
    `Hello,`,
    ``,
    `Your cloud server ${input.serverName} has exceeded the included monthly bandwidth.`,
    ``,
    `Used: ${input.totalGb} GB`,
    `Included: ${input.limitGb} GB`,
    ``,
    `Network speed has been limited to 0.5 Mbps for the current billing cycle. Full speed will be restored automatically when the next cycle starts.`,
    ``,
    `MY RDP HUB`,
  ].join("\n")
}

export async function getBandwidthThrottleSummary(vpsId: string, at = new Date()) {
  const [state, vps] = await Promise.all([
    (prisma as any).bandwidthThrottleState.findUnique({ where: { vpsInstanceId: vpsId } }).catch(() => null),
    prisma.vpsInstance.findUnique({ where: { id: vpsId }, include: { product: { select: { bandwidthTb: true } } } }).catch(() => null),
  ])
  const includedBytes = tbToBytes(vps?.product?.bandwidthTb || 0)
  const totalBytes = await monthlyUsageBytes(vpsId, at)
  return {
    status: state?.status || "clear",
    throttled: String(state?.status || "").toLowerCase() === "throttled",
    currentRateLimit: state?.proxmoxRateValue == null ? null : Number(state.proxmoxRateValue),
    throttleRateMbps: state?.throttleRateMbps == null ? null : Number(state.throttleRateMbps),
    monthlyTotalBytes: Number(totalBytes),
    includedBytes: Number(includedBytes),
    overLimit: includedBytes > BigInt(0) && totalBytes > includedBytes,
    cycleEndsAt: state?.cycleEndsAt?.toISOString ? state.cycleEndsAt.toISOString() : state?.cycleEndsAt || null,
    appliedAt: state?.appliedAt?.toISOString ? state.appliedAt.toISOString() : state?.appliedAt || null,
    restoredAt: state?.restoredAt?.toISOString ? state.restoredAt.toISOString() : state?.restoredAt || null,
  }
}

export async function applyBandwidthThrottle(input: {
  vpsId: string
  actor?: string
  throttleRateMbps?: number
  monthlyTotalBytes?: bigint
  force?: boolean
}) {
  return withRedisLock(`lock:bandwidth-throttle:${input.vpsId}`, 60_000, async () => {
    const vps = await prisma.vpsInstance.findUnique({
      where: { id: input.vpsId },
      include: {
        product: { select: { bandwidthTb: true, name: true } },
        proxmoxNode: true,
        customer: { select: { id: true, name: true, email: true, phone: true } },
        order: { select: { id: true, orderNumber: true } },
      },
    })
    if (!vps?.proxmoxNode) throw new Error("VM node configuration is missing")

    const includedBytes = tbToBytes(vps.product?.bandwidthTb || 0)
    const monthlyTotal = input.monthlyTotalBytes ?? await monthlyUsageBytes(vps.id)
    if (!input.force && (includedBytes <= BigInt(0) || monthlyTotal <= includedBytes)) return { applied: false, reason: "within_limit" }

    const client = createProxmoxClient(vps.proxmoxNode.host, vps.proxmoxNode.tokenId, vps.proxmoxNode.tokenSecret, {
      allowInsecureTls: vps.proxmoxNode.allowInsecureTls,
      timeoutMs: PROXMOX_LONG_TIMEOUT_MS,
    })
    const config = await client.getVMConfig(vps.proxmoxNode.nodeName, vps.vmid)
    const originalNet0 = String(config.net0 || "")
    if (!originalNet0) throw new Error("Primary NIC net0 is missing")

    const throttleRateMbps = input.throttleRateMbps || DEFAULT_THROTTLE_MEGABITS_PER_SECOND
    const proxmoxRateValue = proxmoxRateValueForMbps(throttleRateMbps)
    const throttledNet0 = setNicRateLimit(originalNet0, proxmoxRateValue)
    const existing = await (prisma as any).bandwidthThrottleState.findUnique({ where: { vpsInstanceId: vps.id } }).catch(() => null)
    if (existing?.status === "throttled" && readNicRateLimit(originalNet0) === proxmoxRateValue) {
      return { applied: false, reason: "already_throttled", proxmoxRateValue }
    }

    await client.updateVMConfig(vps.proxmoxNode.nodeName, vps.vmid, { net0: throttledNet0 })
    const verifiedConfig = await client.getVMConfig(vps.proxmoxNode.nodeName, vps.vmid).catch(() => null)
    const verifiedNet0 = String(verifiedConfig?.net0 || throttledNet0)
    const verifiedRate = readNicRateLimit(verifiedNet0)
    if (verifiedRate !== proxmoxRateValue) {
      throw new Error(`Proxmox NIC rate verification failed. Expected rate=${proxmoxRateValue}, found ${verifiedRate ?? "none"}.`)
    }
    const cycle = vpsCycle(vps)
    const state = await (prisma as any).bandwidthThrottleState.upsert({
      where: { vpsInstanceId: vps.id },
      update: {
        status: "throttled",
        limitBytes: includedBytes,
        cycleStartedAt: cycle.cycleStartedAt,
        cycleEndsAt: cycle.cycleEndsAt,
        throttleRateMbps,
        proxmoxRateValue,
        originalNet0: existing?.originalNet0 || originalNet0,
        appliedAt: new Date(),
        restoredAt: null,
        metadata: { monthlyTotalBytes: monthlyTotal.toString(), actor: input.actor || "system", forced: Boolean(input.force), verifiedNet0 },
      },
      create: {
        id: crypto.randomBytes(12).toString("hex"),
        vpsInstanceId: vps.id,
        status: "throttled",
        limitBytes: includedBytes,
        cycleStartedAt: cycle.cycleStartedAt,
        cycleEndsAt: cycle.cycleEndsAt,
        throttleRateMbps,
        proxmoxRateValue,
        originalNet0,
        appliedAt: new Date(),
        metadata: { monthlyTotalBytes: monthlyTotal.toString(), actor: input.actor || "system", forced: Boolean(input.force), verifiedNet0 },
      },
    })

    await (prisma as any).bandwidthUsageAlert.upsert({
      where: { vpsInstanceId_alertType_status: { vpsInstanceId: vps.id, alertType: "throttled", status: "open" } },
      update: { currentBytes: monthlyTotal, thresholdBytes: includedBytes, lastSeenAt: new Date(), message: "Bandwidth limit exceeded. Network speed throttled to 0.5 Mbps." },
      create: {
        vpsInstanceId: vps.id,
        customerId: vps.customerId,
        alertType: "throttled",
        thresholdBytes: includedBytes,
        currentBytes: monthlyTotal,
        message: "Bandwidth limit exceeded. Network speed throttled to 0.5 Mbps.",
        metadata: { proxmoxRateValue, throttleRateMbps },
      },
    }).catch(() => null)

    await createPanelLog({
      category: "Bandwidth",
      level: "warn",
      message: "bandwidth_limit_exceeded_throttle_applied",
      customerId: vps.customerId,
      orderId: vps.orderId,
      vpsInstanceId: vps.id,
      vmid: vps.vmid,
      metadata: { proxmoxRateValue, throttleRateMbps, monthlyTotalBytes: monthlyTotal.toString(), limitBytes: includedBytes.toString() },
    }).catch(() => null)

    if (!state.lastNotifiedAt && vps.customer?.phone) {
      await sendNotification({
        type: "notification",
        channels: ["whatsapp"],
        user: { id: vps.customer.id, email: vps.customer.email, phone: vps.customer.phone, name: vps.customer.name },
        data: {
          templateKey: WHATSAPP_TEMPLATE_KEYS.SYSTEM_FALLBACK,
          message: bandwidthMessage({
            serverName: vps.name,
            totalGb: (Number(monthlyTotal) / 1024 ** 3).toFixed(2),
            limitGb: (Number(includedBytes) / 1024 ** 3).toFixed(2),
          }),
          skipRegistrationCheck: false,
          metadata: { source: "bandwidth_throttle", vpsInstanceId: vps.id },
        },
      }).catch(() => null)
      await (prisma as any).bandwidthThrottleState.update({ where: { vpsInstanceId: vps.id }, data: { lastNotifiedAt: new Date() } }).catch(() => null)
    }

    return { applied: true, proxmoxRateValue, throttleRateMbps, net0: verifiedNet0, verifiedAt: new Date().toISOString() }
  })
}

export async function restoreBandwidthThrottle(input: { vpsId: string; actor?: string; reason?: string }) {
  return withRedisLock(`lock:bandwidth-throttle:${input.vpsId}`, 60_000, async () => {
    const state = await (prisma as any).bandwidthThrottleState.findUnique({ where: { vpsInstanceId: input.vpsId } }).catch(() => null)
    if (!state || state.status !== "throttled") return { restored: false, reason: "not_throttled" }
    const vps = await prisma.vpsInstance.findUnique({ where: { id: input.vpsId }, include: { proxmoxNode: true } })
    if (!vps?.proxmoxNode) throw new Error("VM node configuration is missing")

    const client = createProxmoxClient(vps.proxmoxNode.host, vps.proxmoxNode.tokenId, vps.proxmoxNode.tokenSecret, {
      allowInsecureTls: vps.proxmoxNode.allowInsecureTls,
      timeoutMs: PROXMOX_LONG_TIMEOUT_MS,
    })
    const currentConfig = await client.getVMConfig(vps.proxmoxNode.nodeName, vps.vmid).catch(() => null)
    const restoreNet0 = state.originalNet0 || setNicRateLimit(String(currentConfig?.net0 || ""), null)
    if (restoreNet0) await client.updateVMConfig(vps.proxmoxNode.nodeName, vps.vmid, { net0: restoreNet0 })
    const verifiedConfig = await client.getVMConfig(vps.proxmoxNode.nodeName, vps.vmid).catch(() => null)
    const verifiedNet0 = String(verifiedConfig?.net0 || restoreNet0 || "")
    if (verifiedNet0 && readNicRateLimit(verifiedNet0) !== null && state.originalNet0 && readNicRateLimit(state.originalNet0) === null) {
      throw new Error("Proxmox NIC rate restore verification failed.")
    }

    await (prisma as any).bandwidthThrottleState.update({
      where: { vpsInstanceId: vps.id },
      data: {
        status: "restored",
        restoredAt: new Date(),
        metadata: { ...(state.metadata || {}), restoredBy: input.actor || "system", restoreReason: input.reason || "billing_cycle_reset" },
      },
    })
    await (prisma as any).bandwidthUsageAlert.updateMany({
      where: { vpsInstanceId: vps.id, alertType: "throttled", status: "open" },
      data: { status: "resolved", resolvedAt: new Date() },
    }).catch(() => null)
    await createPanelLog({
      category: "Bandwidth",
      message: "bandwidth_throttle_restored",
      customerId: vps.customerId,
      orderId: vps.orderId,
      vpsInstanceId: vps.id,
      vmid: vps.vmid,
      metadata: { actor: input.actor || "system", reason: input.reason || "billing_cycle_reset" },
    }).catch(() => null)
    return { restored: true, net0: verifiedNet0, verifiedAt: new Date().toISOString() }
  })
}
