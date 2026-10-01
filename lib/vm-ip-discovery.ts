type ProxmoxClientLike = {
  getVMConfig(node: string, vmid: number): Promise<Record<string, any>>
  getVMGuestNetworkInterfaces?(node: string, vmid: number): Promise<any>
}

export type VmIpDiscoveryResult = {
  ipAddress: string | null
  source: "guest_agent" | "panel_allocation" | "dhcp_lease" | "none"
  metadata?: Record<string, unknown>
}

function isUsableIpv4(value: unknown) {
  const ip = String(value || "").trim()
  if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(ip)) return false
  const parts = ip.split(".").map(Number)
  if (parts.some((part) => part < 0 || part > 255)) return false
  if (ip === "0.0.0.0" || ip.startsWith("127.") || ip.startsWith("169.254.")) return false
  return true
}

function ipFromIpConfig(value: unknown) {
  const text = String(value || "")
  const match = text.match(/(?:^|,)ip=([^,\s/]+)/i)
  const ip = match?.[1]
  return isUsableIpv4(ip) ? ip! : null
}

function ipsFromGuestAgent(value: any): string[] {
  const interfaces = Array.isArray(value)
    ? value
    : Array.isArray(value?.result)
      ? value.result
      : Array.isArray(value?.data?.result)
        ? value.data.result
        : []
  const out: string[] = []
  for (const iface of interfaces) {
    const addresses = iface?.["ip-addresses"] || iface?.ipAddresses || iface?.addresses || []
    for (const address of Array.isArray(addresses) ? addresses : []) {
      const ip = address?.["ip-address"] || address?.ip || address?.address
      const family = String(address?.["ip-address-type"] || address?.family || "").toLowerCase()
      if ((family && !family.includes("ipv4")) || !isUsableIpv4(ip)) continue
      out.push(String(ip))
    }
  }
  return [...new Set(out)]
}

function macCandidates(config: Record<string, any> | null | undefined) {
  const out: string[] = []
  for (const [key, value] of Object.entries(config || {})) {
    if (!/^net\d+$/i.test(key)) continue
    const text = String(value || "")
    const match = text.match(/(?:^|=|,)([0-9a-f]{2}(?::[0-9a-f]{2}){5})(?:,|$)/i)
    if (match?.[1]) out.push(match[1].toLowerCase())
  }
  return [...new Set(out)]
}

export function ipFromDhcpLeaseText(value: unknown, input: { macs?: string[] } = {}) {
  const text = String(value || "")
  if (!text.trim()) return null
  const macs = new Set((input.macs || []).map((mac) => mac.toLowerCase()))
  const blocks = text.split(/\n(?=lease\s+\d+\.\d+\.\d+\.\d+\s+\{)/i)
  for (const block of blocks) {
    const ip = block.match(/lease\s+((?:\d{1,3}\.){3}\d{1,3})\s+\{/i)?.[1]
    if (!isUsableIpv4(ip)) continue
    const mac = block.match(/hardware\s+ethernet\s+([0-9a-f:]{17})/i)?.[1]?.toLowerCase()
    if (mac && macs.has(mac)) return ip!
  }
  for (const line of text.split(/\r?\n/)) {
    const ip = line.match(/\b((?:\d{1,3}\.){3}\d{1,3})\b/)?.[1]
    if (!isUsableIpv4(ip)) continue
    const lower = line.toLowerCase()
    if ([...macs].some((mac) => lower.includes(mac))) return ip!
  }
  return null
}

export async function discoverVmIpAddress(input: {
  client: ProxmoxClientLike
  nodeName: string
  vmid: number
  config?: Record<string, any> | null
  allocatedIp?: string | null
  hostname?: string | null
  dhcpLeaseText?: string | null
}): Promise<VmIpDiscoveryResult> {
  const config = input.config || await input.client.getVMConfig(input.nodeName, input.vmid).catch(() => null)

  if (input.client.getVMGuestNetworkInterfaces) {
    const agent = await input.client.getVMGuestNetworkInterfaces(input.nodeName, input.vmid).catch(() => null)
    const agentIp = ipsFromGuestAgent(agent)[0]
    if (agentIp) {
      return { ipAddress: agentIp, source: "guest_agent", metadata: { count: ipsFromGuestAgent(agent).length } }
    }
  }

  // `ipconfig0` and `qm cloudinit dump` are no longer sources: nothing writes
  // them, so reading them would report a stale address from before adoption.
  // The guest agent is authoritative; the panel allocation is the fallback
  // because it is what the guest was asked to configure.

  if (isUsableIpv4(input.allocatedIp)) return { ipAddress: String(input.allocatedIp), source: "panel_allocation" }

  const leaseIp = ipFromDhcpLeaseText(input.dhcpLeaseText, { macs: macCandidates(config) })
  if (leaseIp) return { ipAddress: leaseIp, source: "dhcp_lease" }

  return { ipAddress: null, source: "none" }
}

/**
 * Read a legacy `ipconfig0` value.
 *
 * Only for reconciliation of VMs that were configured before guest automation.
 * It is never used to decide a new VM's address — the guest agent is the only
 * authority for a VM the guest has configured itself.
 */
export function extractConfiguredVmIp(config: Record<string, any> | null | undefined) {
  return ipFromIpConfig(config?.ipconfig0)
}
