type InstanceNameInput = {
  slug?: string | null
  id?: string | null
  name?: string | null
}

type InstanceSpecsInput = {
  cpuCores?: number | null
  vcpu?: number | null
  ramGb?: number | null
  ramGB?: number | null
  storageGb?: number | null
  storageGB?: number | null
  bandwidthTb?: number | null
  bandwidthTB?: number | null
}

export const cloudInstanceNameBySlug: Record<string, string> = {
  "starter-2gb": "Zs2.micro",
  "starter-4gb": "Zs2.small",
  "starter-8gb": "Zs2.medium",
  "pro-16gb": "Zp2.medium",
  "pro-32gb": "Zp2.large",
  "pro-40gb": "Zp2.2xlarge",
  "pro-48gb": "Zp2.xlarge",
  "enterprise-64gb": "Ze3.large",
  "enterprise-96gb": "Ze3.xlarge",
  "enterprise-128gb": "Ze3.2xlarge",
}

export const cloudInstanceNameByLegacyName: Record<string, string> = {
  "starter 2gb": "Zs2.micro",
  "starter 4gb": "Zs2.small",
  "starter 8gb": "Zs2.medium",
  "pro 16gb": "Zp2.medium",
  "pro 32gb": "Zp2.large",
  "pro 40gb": "Zp2.2xlarge",
  "pro 48gb": "Zp2.xlarge",
  "enterprise 64gb": "Ze3.large",
  "enterprise 96gb": "Ze3.xlarge",
  "enterprise 128gb": "Ze3.2xlarge",
}

export function getCloudInstanceName(input: InstanceNameInput | string | null | undefined) {
  if (typeof input === "string") {
    return cloudInstanceNameBySlug[input.toLowerCase()] || cloudInstanceNameByLegacyName[input.toLowerCase()] || input
  }

  const slug = String(input?.slug || input?.id || "").toLowerCase()
  if (slug && cloudInstanceNameBySlug[slug]) return cloudInstanceNameBySlug[slug]

  const name = String(input?.name || "").toLowerCase()
  if (name && cloudInstanceNameByLegacyName[name]) return cloudInstanceNameByLegacyName[name]

  return input?.name || "Cloud Instance"
}

export function formatCloudInstanceSpecs(input: InstanceSpecsInput) {
  const cpu = Number(input.cpuCores ?? input.vcpu ?? 0)
  const ram = Number(input.ramGb ?? input.ramGB ?? 0)
  const storage = Number(input.storageGb ?? input.storageGB ?? 0)
  const bandwidth = Number(input.bandwidthTb ?? input.bandwidthTB ?? 0)

  return [
    cpu > 0 ? `${cpu} vCPU` : null,
    ram > 0 ? `${ram}GB RAM` : null,
    storage > 0 ? `${storage}GB NVMe Storage` : "NVMe Storage",
    bandwidth > 0 ? `${bandwidth}TB Bandwidth` : null,
  ].filter(Boolean).join(" • ")
}
