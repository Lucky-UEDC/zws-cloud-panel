import "dotenv/config"
import { prisma } from "@/lib/db"
import { createProxmoxClient, PROXMOX_LONG_TIMEOUT_MS } from "@/lib/proxmox"
import { verifyDiskSizeFromConfig } from "@/lib/provision"

// READ-ONLY: for every active VPS, compare ordered diskGb vs the live Proxmox OS-disk size
// (verifyDiskSizeFromConfig uses the fixed OS/boot-disk selection). Flags wrong-size disks.
async function main() {
  const vms = await prisma.vpsInstance.findMany({
    where: { deletedAt: null },
    select: {
      vmid: true, ipAddress: true, hostname: true, name: true, diskGb: true, status: true,
      proxmoxNode: { select: { nodeName: true, host: true, tokenId: true, tokenSecret: true, allowInsecureTls: true } },
    },
  })
  const clients = new Map<string, ReturnType<typeof createProxmoxClient>>()
  const results: any[] = []
  for (const v of vms) {
    const n = v.proxmoxNode
    if (!n || !v.vmid) { results.push({ vmid: v.vmid, ip: v.ipAddress, skip: "no node/vmid" }); continue }
    let client = clients.get(n.nodeName)
    if (!client) {
      client = createProxmoxClient(n.host, n.tokenId, n.tokenSecret, { allowInsecureTls: n.allowInsecureTls, timeoutMs: PROXMOX_LONG_TIMEOUT_MS })
      clients.set(n.nodeName, client)
    }
    try {
      const cfg = await client.getVMConfig(n.nodeName, v.vmid)
      const ordered = Number(v.diskGb || 0)
      const chk = verifyDiskSizeFromConfig(cfg as Record<string, any>, ordered)
      results.push({ vmid: v.vmid, ip: v.ipAddress, node: n.nodeName, status: v.status, orderedGb: ordered, actualGb: chk.actualGb, diskKey: chk.diskKey, ok: chk.ok })
    } catch (e: any) {
      results.push({ vmid: v.vmid, ip: v.ipAddress, node: n.nodeName, error: (e?.message || String(e)).slice(0, 140) })
    }
  }
  const mismatches = results.filter((r) => r.ok === false)
  const errors = results.filter((r) => r.error)
  const ok = results.filter((r) => r.ok === true)
  console.log(JSON.stringify({
    total: vms.length,
    okCount: ok.length,
    mismatchCount: mismatches.length,
    errorCount: errors.length,
    mismatches,
    errorsSample: errors.slice(0, 6),
    okSample: ok.slice(0, 8),
  }, null, 2))
}

main()
  .then(async () => { await prisma.$disconnect(); process.exit(0) })
  .catch(async (err) => { console.error("[audit-disks] failed", err); await prisma.$disconnect().catch(() => null); process.exit(1) })
