type TopologySource = {
  defaultCpuSockets?: number | null
  defaultCoresPerSocket?: number | null
}

type NodeTopologySource = {
  defaultVmSockets?: number | null
  cpuSocketsDetected?: number | null
}

export type CpuTopology = {
  sockets: number
  coresPerSocket: number
  totalVcpu: number
}

export function validateCpuTopology(topology: CpuTopology) {
  if (!Number.isInteger(topology.sockets) || topology.sockets < 1) throw new Error("Invalid CPU topology.")
  if (!Number.isInteger(topology.coresPerSocket) || topology.coresPerSocket < 1) throw new Error("Invalid CPU topology.")
  if (topology.sockets * topology.coresPerSocket !== topology.totalVcpu) throw new Error("Invalid CPU topology.")
  return topology
}

function fromSockets(vcpu: number, sockets?: number | null): CpuTopology | null {
  const parsed = Number(sockets || 0)
  if (!Number.isInteger(parsed) || parsed < 1) return null
  if (vcpu % parsed !== 0) return null
  return validateCpuTopology({ sockets: parsed, coresPerSocket: vcpu / parsed, totalVcpu: vcpu })
}

export function resolveCpuTopology(input: {
  vcpu: number
  node?: NodeTopologySource | null
  product?: TopologySource | null
  offer?: TopologySource | null
  adminOverride?: { sockets?: number | null; coresPerSocket?: number | null } | null
}): CpuTopology {
  const vcpu = Number(input.vcpu || 0)
  if (!Number.isInteger(vcpu) || vcpu < 1) throw new Error("Invalid CPU topology.")

  if (input.adminOverride?.sockets || input.adminOverride?.coresPerSocket) {
    return validateCpuTopology({
      sockets: Number(input.adminOverride.sockets || 0),
      coresPerSocket: Number(input.adminOverride.coresPerSocket || 0),
      totalVcpu: vcpu,
    })
  }

  const explicit = input.offer || input.product
  if (explicit?.defaultCpuSockets) {
    const resolved = fromSockets(vcpu, explicit.defaultCpuSockets)
    if (resolved) return resolved
  }
  if (explicit?.defaultCoresPerSocket) {
    const coresPerSocket = Number(explicit.defaultCoresPerSocket)
    if (Number.isInteger(coresPerSocket) && coresPerSocket > 0 && vcpu % coresPerSocket === 0) {
      return validateCpuTopology({ sockets: vcpu / coresPerSocket, coresPerSocket, totalVcpu: vcpu })
    }
  }

  const nodeSockets = input.node?.defaultVmSockets || input.node?.cpuSocketsDetected
  const nodeResolved = fromSockets(vcpu, nodeSockets)
  if (nodeResolved) return nodeResolved

  if (vcpu > 1 && vcpu % 2 === 0) {
    return { sockets: 2, coresPerSocket: vcpu / 2, totalVcpu: vcpu }
  }

  return { sockets: 1, coresPerSocket: vcpu, totalVcpu: vcpu }
}
