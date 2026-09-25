import { prisma } from "@/lib/db"
import {
  createProxmoxClient,
  normalizeProxmoxEndpoint,
  normalizeProxmoxHost,
  PROXMOX_METRICS_TIMEOUT_MS,
} from "@/lib/proxmox"

function usage() {
  console.error("Usage: pnpm tsx scripts/debug-proxmox-node.ts <nodeRecordId-or-name>")
}

function safeError(error: any) {
  return {
    layer: error?.layer || "unknown",
    endpoint: error?.endpoint || null,
    status: error?.status || 0,
    message: String(error?.message || "Proxmox request failed"),
  }
}

async function step(label: string, endpoint: string, fn: () => Promise<any>) {
  const startedAt = Date.now()
  const normalizedEndpoint = normalizeProxmoxEndpoint(endpoint)
  try {
    const data = await fn()
    const count = Array.isArray(data) ? ` count=${data.length}` : ""
    console.log(`PASS ${label} endpoint=${normalizedEndpoint} ms=${Date.now() - startedAt}${count}`)
  } catch (error: any) {
    const safe = safeError(error)
    console.log(
      `FAIL ${label} layer=${safe.layer} endpoint=${safe.endpoint || normalizedEndpoint} status=${safe.status} ms=${Date.now() - startedAt} message=${safe.message}`,
    )
  }
}

async function main() {
  const key = String(process.argv[2] || "").trim()
  if (!key) {
    usage()
    process.exitCode = 1
    return
  }

  const node = await prisma.proxmoxNode.findFirst({
    where: {
      OR: [
        { id: key },
        { name: key },
        { nodeName: key },
      ],
    },
  })

  if (!node) {
    console.log(`FAIL load_node layer=db endpoint=local status=404 message=Node not found`)
    process.exitCode = 1
    return
  }

  console.log(`[proxmox] node_loaded id=${node.id} name=${node.name}`)

  let normalizedHost = ""
  try {
    normalizedHost = normalizeProxmoxHost(node.host)
    console.log(`PASS normalize_host host=${normalizedHost} allowInsecureTls=${node.allowInsecureTls}`)
  } catch (error: any) {
    const safe = safeError(error)
    console.log(`FAIL normalize_host layer=${safe.layer} endpoint=local status=${safe.status} message=${safe.message}`)
    process.exitCode = 1
    return
  }

  const client = createProxmoxClient(normalizedHost, node.tokenId, node.tokenSecret, {
    allowInsecureTls: node.allowInsecureTls,
    timeoutMs: PROXMOX_METRICS_TIMEOUT_MS,
  })

  await step("GET /version", "/version", () => client.safeGet("/version"))
  await step("GET /nodes", "/nodes", () => client.getNodes())
  await step(`GET /nodes/${node.nodeName}/status`, `/nodes/${node.nodeName}/status`, () => client.getNodeStats(node.nodeName))
  await step(`GET /nodes/${node.nodeName}/qemu`, `/nodes/${node.nodeName}/qemu`, () => client.getVMList(node.nodeName))
  await step(`GET /nodes/${node.nodeName}/storage`, `/nodes/${node.nodeName}/storage`, () => client.getNodeStorage(node.nodeName))
  await step(`GET /nodes/${node.nodeName}/tasks?limit=5`, `/nodes/${node.nodeName}/tasks?limit=5`, () =>
    client.safeGet(`/nodes/${node.nodeName}/tasks?limit=5`),
  )
}

main()
  .catch((error) => {
    const safe = safeError(error)
    console.log(`FAIL debug_proxmox layer=${safe.layer} endpoint=${safe.endpoint || "local"} status=${safe.status} message=${safe.message}`)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
