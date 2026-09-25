import dns from "node:dns/promises"
import net from "node:net"

function reverseIpv4(ip: string) {
  return ip.split(".").reverse().join(".")
}

async function txt(name: string) {
  const rows = await dns.resolveTxt(name).catch(() => [])
  return rows.flat().join(" ").replace(/^"|"$/g, "")
}

async function tcpLatencyMs(host: string, port: number) {
  const start = Date.now()
  return new Promise<number | null>((resolve) => {
    const socket = new net.Socket()
    let done = false
    const finish = (value: number | null) => {
      if (done) return
      done = true
      socket.destroy()
      resolve(value)
    }
    socket.setTimeout(1500)
    socket.once("connect", () => finish(Date.now() - start))
    socket.once("timeout", () => finish(null))
    socket.once("error", () => finish(null))
    socket.connect(port, host)
  })
}

export async function resolveNetworkIntelligence(input: {
  ipAddress?: string | null
  nodeLocation?: string | null
  nodeName?: string | null
  providerName?: string | null
}) {
  const ip = String(input.ipAddress || "").trim()
  if (!ip || ip.includes(":")) {
    return {
      provider: input.providerName || "Unknown provider",
      asn: null,
      asName: null,
      reverseDns: null,
      country: null,
      region: input.nodeLocation || null,
      latencyMs: null,
      routeQuality: "unknown",
      reputation: "unknown",
      transit: "BGP optimized",
      source: "metadata",
    }
  }

  const [reverseDnsRows, cymru] = await Promise.all([
    dns.reverse(ip).catch(() => [] as string[]),
    txt(`${reverseIpv4(ip)}.origin.asn.cymru.com`),
  ])
  const parts = cymru.split("|").map((part) => part.trim())
  const asn = parts[0] && parts[0] !== "NA" ? `AS${parts[0]}` : null
  const country = parts[2] || null
  const asName = asn ? await txt(`${asn}.asn.cymru.com`).then((row) => row.split("|").slice(4).join("|").trim() || null).catch(() => null) : null
  const latency = await tcpLatencyMs(ip, 22).then((ssh) => ssh ?? tcpLatencyMs(ip, 3389)).catch(() => null)
  const routeQuality = latency === null ? "unverified" : latency <= 20 ? "excellent" : latency <= 80 ? "good" : "degraded"

  return {
    provider: input.providerName || asName || "Unknown provider",
    asn,
    asName,
    reverseDns: reverseDnsRows[0] || null,
    country,
    region: input.nodeLocation || country || null,
    latencyMs: latency,
    routeQuality,
    reputation: "unknown",
    transit: "BGP optimized",
    source: "team-cymru-dns",
  }
}
