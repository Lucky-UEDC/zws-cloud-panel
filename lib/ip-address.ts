export function ipToNumber(ip: string): number {
  const parts = String(ip || "").trim().split(".").map((part) => Number(part))
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    throw new Error("Invalid IPv4 address")
  }
  return (((parts[0] * 256 + parts[1]) * 256 + parts[2]) * 256 + parts[3]) >>> 0
}

export function numberToIp(value: number): string {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new Error("Invalid IPv4 number")
  }
  return [
    (value >>> 24) & 255,
    (value >>> 16) & 255,
    (value >>> 8) & 255,
    value & 255,
  ].join(".")
}

export function expandIpRange(startIp: string, endIp: string): string[] {
  const start = ipToNumber(startIp)
  const end = ipToNumber(endIp)
  if (end < start) throw new Error("IP range end must be greater than or equal to start")
  const size = end - start + 1
  if (size > 4096) throw new Error("IP range is too large; split it into smaller pools")
  return Array.from({ length: size }, (_, index) => numberToIp(start + index))
}

export function isIpInRange(ip: string, startIp: string, endIp: string): boolean {
  const value = ipToNumber(ip)
  return value >= ipToNumber(startIp) && value <= ipToNumber(endIp)
}

export function isValidIpv4(ip: string): boolean {
  try {
    ipToNumber(ip)
    return true
  } catch {
    return false
  }
}

export function compareIpv4(left: string, right: string): number {
  return ipToNumber(left) - ipToNumber(right)
}

export function rangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return ipToNumber(aStart) <= ipToNumber(bEnd) && ipToNumber(bStart) <= ipToNumber(aEnd)
}

export function cidrMask(cidr: number): number {
  if (!Number.isInteger(cidr) || cidr < 0 || cidr > 32) throw new Error("CIDR must be between 0 and 32")
  return cidr === 0 ? 0 : (0xffffffff << (32 - cidr)) >>> 0
}

export function isIpInSubnet(ip: string, subnetIp: string, cidr: number): boolean {
  const mask = cidrMask(cidr)
  return (ipToNumber(ip) & mask) === (ipToNumber(subnetIp) & mask)
}

export function validateIpRange(startIp: string, endIp: string) {
  if (!isValidIpv4(startIp)) throw new Error("Start IP must be a valid IPv4 address")
  if (!isValidIpv4(endIp)) throw new Error("End IP must be a valid IPv4 address")
  if (compareIpv4(startIp, endIp) > 0) throw new Error("Start IP must be less than or equal to end IP")
}
