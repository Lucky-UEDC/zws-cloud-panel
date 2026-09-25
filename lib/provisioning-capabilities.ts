export type SupportedOsType = "HYBRID"

export function supportedOsTypeForFamilies(families: unknown[]): SupportedOsType {
  return "HYBRID"
}

export function templateCompatibleOsTypes(osFamily: unknown) {
  return ["HYBRID"]
}

export async function syncTemplateCapability(templateId: string) {
  return { templateId, compatibleOs: ["ANY"] }
}

export async function syncNodeCapabilities(nodeId: string) {
  return { nodeId, osFamilies: [] as string[] }
}
