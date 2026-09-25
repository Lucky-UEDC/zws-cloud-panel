import { getSetting, type ProvisioningSettings } from "@/lib/settings"

export type AutoProvisionOverride = "inherit" | boolean

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export function normalizeAutoProvisionOverride(value: unknown): AutoProvisionOverride {
  if (value === true || value === false) return value
  const text = String(value ?? "inherit").trim().toLowerCase()
  if (["on", "true", "yes", "enabled"].includes(text)) return true
  if (["off", "false", "no", "disabled"].includes(text)) return false
  return "inherit"
}

export function resolveAutoProvision(input: {
  globalEnabled?: boolean | null
  product?: { metadata?: unknown } | null
}) {
  const globalEnabled = input.globalEnabled !== false
  const override = normalizeAutoProvisionOverride(metadataRecord(input.product?.metadata).autoProvision)
  if (override !== "inherit") {
    return { enabled: override, source: "product" as const, override }
  }
  return { enabled: globalEnabled, source: "global" as const, override }
}

export async function resolveAutoProvisionForProduct(product?: { metadata?: unknown } | null) {
  const settings = await getSetting<ProvisioningSettings>("provisioning_settings")
  return resolveAutoProvision({ globalEnabled: settings.autoProvisioningEnabled, product })
}

