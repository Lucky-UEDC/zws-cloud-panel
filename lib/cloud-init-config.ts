import { isWindowsTemplateName } from "@/lib/os-template-normalization"

export type CloudInitFamily = "linux" | "windows"

export type BuildCloudInitConfigInput = {
  vmid: number
  osFamily?: string | null
  username?: string | null
  password: string
  hostname: string
  ip: string
  cidr: number
  gateway: string
  dns?: string | null
  searchDomain?: string | null
  cloudInitStorage?: string | null
  sshPublicKey?: string | null
}

export type BuiltCloudInitConfig = {
  family: CloudInitFamily
  username: string
  config: Record<string, any>
  verification: {
    expectedUser: string
    expectedIp: string
    expectedCidr: number
    expectedIpConfig: string
    expectedNameservers: string[]
    expectedGateway: string
    expectedHostname: string
    expectedSearchDomain: string
    expectedCloudInitDrive: string
  }
  maskedCommands: string[]
}

function normalizeDns(dns?: string | null) {
  const values = String(dns || "")
    .split(/[,\s]+/)
    .map((value) => value.trim())
    .filter(Boolean)
  const resolved = values.length ? values : ["8.8.8.8", "8.8.4.4"]
  return {
    value: resolved.join(" "),
    servers: resolved,
  }
}

export function resolveCloudInitFamily(input: unknown): CloudInitFamily {
  const value = String(input || "")
  const linuxSignals = /\b(ubuntu|debian|centos|alma|rocky|fedora|alpine|suse|linux)\b/i
  return isWindowsTemplateName(value) || (/\bserver\b/i.test(value) && !linuxSignals.test(value)) ? "windows" : "linux"
}

export function buildCloudInitConfig(input: BuildCloudInitConfigInput): BuiltCloudInitConfig {
  const family = resolveCloudInitFamily(input.osFamily)
  const username = family === "windows" ? String(input.username || "Administrator") : "root"
  const dns = normalizeDns(input.dns)
  const defaultSearchDomain = "localdomain"
  const searchDomain = family === "linux" ? defaultSearchDomain : String(input.searchDomain || defaultSearchDomain).trim() || defaultSearchDomain
  const storage = String(input.cloudInitStorage || "local-lvm").trim() || "local-lvm"
  const ipconfig0 = `ip=${input.ip}/${input.cidr},gw=${input.gateway}`
  const citype = family === "windows" ? "configdrive2" : "nocloud"

  const config: Record<string, any> = {
    ide2: `${storage}:cloudinit`,
    citype,
    ciuser: username,
    cipassword: input.password,
    name: input.hostname,
    nameserver: dns.value,
    searchdomain: searchDomain,
    ipconfig0,
  }

  if (family === "linux" && input.sshPublicKey) {
    config.sshkeys = String(input.sshPublicKey)
  }

  const baseCommands = [
    `qm set ${input.vmid} --ide2 ${config.ide2}`,
    `qm set ${input.vmid} --citype ${citype}`,
    `qm set ${input.vmid} --ciuser ${username}`,
    `qm set ${input.vmid} --cipassword [redacted]`,
    `qm set ${input.vmid} --ipconfig0 "${ipconfig0}"`,
    `qm set ${input.vmid} --nameserver "${dns.value}"`,
    `qm set ${input.vmid} --searchdomain ${searchDomain}`,
    `qm set ${input.vmid} --hostname ${input.hostname}`,
  ]

  return {
    family,
    username,
    config,
    verification: {
      expectedUser: username,
      expectedIp: input.ip,
      expectedCidr: input.cidr,
      expectedIpConfig: ipconfig0,
      expectedNameservers: dns.servers,
      expectedGateway: input.gateway,
      expectedHostname: input.hostname,
      expectedSearchDomain: searchDomain,
      expectedCloudInitDrive: config.ide2,
    },
    maskedCommands: [...baseCommands, `qm cloudinit update ${input.vmid}`],
  }
}

export function validateCloudInitDump(input: {
  built: BuiltCloudInitConfig
  userDump: unknown
  networkDump: unknown
  vmConfig?: Record<string, any> | null
}) {
  const user = typeof input.userDump === "string" ? input.userDump : JSON.stringify(input.userDump || "")
  const network = typeof input.networkDump === "string" ? input.networkDump : JSON.stringify(input.networkDump || "")
  const vmConfig = input.vmConfig && typeof input.vmConfig === "object" ? input.vmConfig : {}
  const userLower = user.toLowerCase()
  const networkLower = network.toLowerCase()
  const missing: string[] = []

  if (!userLower.includes(input.built.verification.expectedUser.toLowerCase())) missing.push("user")
  if (!/passw(or)?d|chpasswd|cipassword/i.test(user)) missing.push("password")
  // Hostname is guest metadata. Windows sysprep, cloudbase-init, cloud-init, or
  // the customer may legitimately change it, so it must never be a delivery
  // gate. Keep expectedHostname in the evidence object for observability only.
  if (!network.trim()) missing.push("network")
  if (
    !networkLower.includes(input.built.verification.expectedIpConfig.toLowerCase()) &&
    !networkLower.includes(input.built.verification.expectedIp.toLowerCase())
  ) {
    missing.push("ipconfig0")
  }
  if (!networkLower.includes(input.built.verification.expectedGateway.toLowerCase())) missing.push("gateway")
  for (const dns of input.built.verification.expectedNameservers) {
    if (!networkLower.includes(dns.toLowerCase())) missing.push(`nameserver:${dns}`)
  }
  if (!networkLower.includes(input.built.verification.expectedSearchDomain.toLowerCase())) missing.push("searchdomain")

  if (input.built.family === "linux") {
    const configUser = String(vmConfig.ciuser || "").trim()
    const configIp = String(vmConfig.ipconfig0 || "").trim()
    const configNameservers = String(vmConfig.nameserver || "").split(/[,\s]+/).filter(Boolean)
    const configSearchDomain = String(vmConfig.searchdomain || "").trim()
    if (configUser !== input.built.verification.expectedUser) missing.push("config:ciuser")
    if (configIp !== input.built.verification.expectedIpConfig) missing.push("config:ipconfig0")
    for (const dns of input.built.verification.expectedNameservers) {
      if (!configNameservers.includes(dns)) missing.push(`config:nameserver:${dns}`)
    }
    if (configSearchDomain !== input.built.verification.expectedSearchDomain) missing.push("config:searchdomain")
    if (!hasCloudInitDrive(vmConfig)) missing.push("config:cloudinit_drive")
  }

  return {
    ok: missing.length === 0,
    missing,
    userDumpLength: user.length,
    networkDumpLength: network.length,
  }
}

function hasCloudInitDrive(vmConfig: Record<string, any>) {
  return Object.keys(vmConfig).some((key) => {
    if (!/^(ide\d+|scsi\d+|sata\d+)$/i.test(key)) return false
    return String(vmConfig[key] || "").toLowerCase().includes("cloudinit")
  })
}

export function validateCloudInitPreBoot(config: Record<string, any>): { ok: boolean; missing: string[] } {
  const missing: string[] = []
  const ipconfig0 = String(config.ipconfig0 || "")
  if (!ipconfig0.includes("ip=") || !ipconfig0.includes("gw=")) missing.push("ipconfig0")
  if (!String(config.ciuser || "").trim()) missing.push("ciuser")
  if (!String(config.cipassword || "").trim()) missing.push("cipassword")
  if (!String(config.nameserver || "").trim()) missing.push("nameserver")
  if (!String(config.searchdomain || "").trim()) missing.push("searchdomain")
  if (!hasCloudInitDrive(config)) missing.push("cloudinit_drive")
  return { ok: missing.length === 0, missing }
}
