import { NextRequest, NextResponse } from "next/server"
import { getClientFromCookies } from "@/lib/server-auth"
import { prisma } from "@/lib/db"
import { createProxmoxClient } from "@/lib/proxmox"
import { resolveBackupTargetForInstance } from "@/lib/proxmox-backup"

export const dynamic = "force-dynamic"
export const revalidate = 0

const NO_CACHE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
}

export async function GET(request: NextRequest) {
  const customer = await getClientFromCookies()
  const customerId = String(customer?.sub || "")
  if (!customerId) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401, headers: NO_CACHE_HEADERS })

  const url = new URL(request.url)
  const vpsInstanceId = String(url.searchParams.get("vpsInstanceId") || "")
  if (!vpsInstanceId) return NextResponse.json({ error: "vpsInstanceId is required" }, { status: 400, headers: NO_CACHE_HEADERS })

  const instance = await prisma.vpsInstance.findFirst({
    where: { id: vpsInstanceId, customerId, deletedAt: null, vmid: { gt: 0 } },
    include: { proxmoxNode: { select: { id: true, nodeName: true, host: true, tokenId: true, tokenSecret: true, allowInsecureTls: true, status: true } } },
  })
  if (!instance || !instance.vmid) return NextResponse.json({ error: "Instance not found" }, { status: 404, headers: NO_CACHE_HEADERS })

  const node = instance.proxmoxNode
  const target = await resolveBackupTargetForInstance({ nodeId: instance.proxmoxNodeId, vmid: Number(instance.vmid) })

  const latestBackup = await prisma.vmBackup.findFirst({
    where: { vpsInstanceId: instance.id, status: "completed" },
    orderBy: { completedAt: "desc" },
    select: { id: true, status: true, completedAt: true, sizeBytes: true, startedAt: true },
  })

  let vm: Record<string, unknown> | null = null
  let liveStatus: string | null = null

  if (node && node.host) {
    const client = createProxmoxClient(node.host, node.tokenId, node.tokenSecret, { allowInsecureTls: Boolean(node.allowInsecureTls), timeoutMs: 20000 })
    try {
      const vmStatus = await client.getVMStatus(node.nodeName, Number(instance.vmid)).catch(() => null)
      const data = vmStatus?.data ?? vmStatus ?? null
      if (data) {
        vm = {
          name: String(data.name || instance.instanceName || instance.name || `VM-${instance.vmid}`),
          status: String(data.status || "unknown"),
          maxmem: Number(data.maxmem || 0),
          mem: Number(data.mem || 0),
          maxcpu: Number((data.cpus ?? data.maxcpu) || 0),
          uptime: Number(data.uptime || 0),
          ip: typeof data["ip-address"] === "string" ? data["ip-address"] : null,
        }
        liveStatus = String(data.status || "unknown")
      }
    } catch {
      // live data best-effort
    }
  }

  return NextResponse.json(
    {
      success: true,
      instance: {
        vpsInstanceId: instance.id,
        name: instance.displayTag || instance.instanceName || instance.name || instance.hostname || `VM-${instance.vmid}`,
      },
      vm,
      // NOTE: internal storage details (storage IDs, node names, disk capacity)
      // are intentionally NOT exposed to the customer. The admin panel surfaces
      // operational storage information where required.
      backupTarget: target
        ? {
            policy: target.policy
              ? {
                  id: target.policy.id,
                  name: target.policy.name,
                  retention: target.policy.retention,
                  scheduleMinutes: target.policy.scheduleMinutes,
                  nextRunAt: target.policy.nextRunAt ? target.policy.nextRunAt.toISOString() : null,
                  lastRunAt: target.policy.lastRunAt ? target.policy.lastRunAt.toISOString() : null,
                }
              : null,
          }
        : null,
      latestBackup: latestBackup
        ? { id: latestBackup.id, status: latestBackup.status, startedAt: latestBackup.startedAt ? latestBackup.startedAt.toISOString() : null, completedAt: latestBackup.completedAt ? latestBackup.completedAt.toISOString() : null, sizeBytes: latestBackup.sizeBytes != null ? String(latestBackup.sizeBytes) : null }
        : null,
      requiresShutdown: liveStatus !== null && liveStatus !== "stopped" && liveStatus !== "not-running",
    },
    { headers: NO_CACHE_HEADERS },
  )
}