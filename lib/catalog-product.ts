export const PRODUCT_FAMILIES = ["fixed_vps", "configurable", "dedicated"] as const
export type ProductFamily = (typeof PRODUCT_FAMILIES)[number]

export const CTA_MODES = ["purchase_now", "configure", "contact_sales"] as const
export type ProductCtaMode = (typeof CTA_MODES)[number]

export function normalizeProductFamily(value: unknown): ProductFamily {
  const normalized = String(value || "").toLowerCase().trim()
  if (normalized === "fixed" || normalized === "fixed_vps") return "fixed_vps"
  if (normalized === "configurable") return "configurable"
  if (normalized === "service" || normalized === "dedicated" || normalized === "bms") return "dedicated"
  return "fixed_vps"
}

export function normalizeCtaMode(value: unknown, family: ProductFamily): ProductCtaMode {
  const normalized = String(value || "").toLowerCase().trim()
  if (normalized === "purchase_now") return "purchase_now"
  if (normalized === "configure") return "configure"
  if (normalized === "contact_sales") return "contact_sales"

  if (family === "configurable") return "configure"
  if (family === "dedicated") return "purchase_now"
  return "purchase_now"
}

export function defaultCtaLabel(family: ProductFamily, name: string): string {
  if (family === "configurable") return "Configure"
  if (family === "dedicated") return "Purchase Now"
  const match = name.match(/(\d+\s*GB)/i)
  return "Deploy Now"
}

export function normalizeBadges(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .slice(0, 6)
}

export function toPublicType(family: ProductFamily): "fixed_vps" | "configurable" | "dedicated" {
  return family
}
