export type CounterSnapshot = {
  rxBytes: number
  txBytes: number
  sampledAt: number
}

export type LiveBandwidthVmRow = {
  vpsInstanceId: string
  customerId?: string | null
  customerName?: string | null
  customerEmail?: string | null
  vmName: string
  vmid: number | null
  ipAddress?: string | null
  nodeId: string | null
  nodeName: string
  rxBytes?: number
  txBytes?: number
  totalBytes?: number
  rxRateBps: number
  txRateBps: number
  currentMbps: number
  currentKbps: number
  peakRateBps: number
  throttled: boolean
  throttleRateMbps: number | null
  currentRateLimit: number | null
  proxmoxRateValue: number | null
  net0?: string | null
  liveState: "active" | "throttled" | "idle" | "stale"
  sampledAt: string
  source: string
}

export type LiveBandwidthNodeRow = {
  nodeId: string | null
  nodeName: string
  rxRateBps: number
  txRateBps: number
  activeMbps: number
  currentKbps: number
  peakRateBps: number
  activeVmCount: number
  throttledVmCount: number
  sampledAt: string
}

function numberValue(value: unknown) {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) ? parsed : 0
}

export function bytesPerSecondToMbps(value: unknown) {
  return Number(((numberValue(value) * 8) / 1_000_000).toFixed(3))
}

export function bytesPerSecondToKbps(value: unknown) {
  return Number(((numberValue(value) * 8) / 1_000).toFixed(1))
}

export function safeCounterDelta(previous: unknown, current: unknown) {
  const before = Math.max(0, Math.floor(numberValue(previous)))
  const after = Math.max(0, Math.floor(numberValue(current)))
  return after >= before ? after - before : 0
}

export function calculateLiveBandwidth(previous: CounterSnapshot | null | undefined, current: CounterSnapshot) {
  if (!previous?.sampledAt) {
    return { rxDelta: 0, txDelta: 0, seconds: 0, rxRateBps: 0, txRateBps: 0, currentMbps: 0, currentKbps: 0 }
  }
  const seconds = Math.max(0.25, (current.sampledAt - previous.sampledAt) / 1000)
  const rxDelta = safeCounterDelta(previous.rxBytes, current.rxBytes)
  const txDelta = safeCounterDelta(previous.txBytes, current.txBytes)
  const rxRateBps = Math.round(rxDelta / seconds)
  const txRateBps = Math.round(txDelta / seconds)
  const combined = rxRateBps + txRateBps
  return {
    rxDelta,
    txDelta,
    seconds,
    rxRateBps,
    txRateBps,
    currentMbps: bytesPerSecondToMbps(combined),
    currentKbps: bytesPerSecondToKbps(combined),
  }
}

export function liveBandwidthState(input: { rxRateBps?: unknown; txRateBps?: unknown; throttled?: boolean; sampledAt?: string | Date | null; now?: number }) {
  if (input.throttled) return "throttled" as const
  const sampledAt = input.sampledAt ? new Date(input.sampledAt).getTime() : 0
  const now = input.now || Date.now()
  if (!sampledAt || now - sampledAt > 5000) return "stale" as const
  const combined = numberValue(input.rxRateBps) + numberValue(input.txRateBps)
  return combined > 1024 ? "active" as const : "idle" as const
}

export function aggregateLiveBandwidthNodes(vms: LiveBandwidthVmRow[]): LiveBandwidthNodeRow[] {
  const byNode = new Map<string, LiveBandwidthNodeRow>()
  for (const vm of vms) {
    const key = vm.nodeId || vm.nodeName || "unknown"
    const current = byNode.get(key) || {
      nodeId: vm.nodeId,
      nodeName: vm.nodeName || key,
      rxRateBps: 0,
      txRateBps: 0,
      activeMbps: 0,
      currentKbps: 0,
      peakRateBps: 0,
      activeVmCount: 0,
      throttledVmCount: 0,
      sampledAt: vm.sampledAt,
    }
    current.rxRateBps += Math.max(0, Math.floor(numberValue(vm.rxRateBps)))
    current.txRateBps += Math.max(0, Math.floor(numberValue(vm.txRateBps)))
    current.peakRateBps = Math.max(current.peakRateBps, numberValue(vm.peakRateBps), numberValue(vm.rxRateBps) + numberValue(vm.txRateBps))
    current.activeVmCount += vm.liveState === "active" || vm.liveState === "throttled" ? 1 : 0
    current.throttledVmCount += vm.throttled ? 1 : 0
    current.sampledAt = vm.sampledAt > current.sampledAt ? vm.sampledAt : current.sampledAt
    byNode.set(key, current)
  }
  return Array.from(byNode.values()).map((row) => {
    const combined = row.rxRateBps + row.txRateBps
    return {
      ...row,
      activeMbps: bytesPerSecondToMbps(combined),
      currentKbps: bytesPerSecondToKbps(combined),
    }
  })
}

export function throttleStatusLabel(input: { throttled?: boolean; throttleRateMbps?: unknown; currentRateLimit?: unknown }) {
  if (!input.throttled) return "Clear"
  const mbps = numberValue(input.throttleRateMbps) || (numberValue(input.currentRateLimit) ? numberValue(input.currentRateLimit) * 8 : 0.5)
  return `THROTTLED • ${Number(mbps.toFixed(3)).toString()} Mbps`
}
