import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
const read = (path: string) => readFileSync(`${root}/${path}`, "utf8")

test("asset URLs resolve appearance/brand settings before stale general defaults", () => {
  const siteSettings = read("lib/settings/site-settings.ts")
  assert.match(siteSettings, /logoUrl: cleanAssetUrl\(brand\?\.logoUrl \|\| general\?\.logoUrl\)/)
  assert.match(siteSettings, /faviconUrl: cleanAssetUrl\(brand\?\.faviconUrl\)/)
  assert.match(
    siteSettings,
    /footerLogoUrl: cleanAssetUrl\(brand\?\.footerLogoUrl \|\| general\?\.footerLogoUrl \|\| brand\?\.logoUrl \|\| general\?\.logoUrl\)/,
  )
  assert.match(
    siteSettings,
    /invoiceLogoUrl: cleanAssetUrl\(brand\?\.invoiceLogoUrl \|\| general\?\.invoiceLogoUrl \|\| brand\?\.logoUrl \|\| general\?\.logoUrl\)/,
  )
  assert.match(
    siteSettings,
    /openGraphImageUrl: cleanAssetUrl\(brand\?\.openGraphImageUrl \|\| general\?\.openGraphImageUrl \|\| brand\?\.logoUrl \|\| general\?\.logoUrl\)/,
  )
})

test("brand resolution favors configured appearance uploads over general icon fallback", () => {
  const brandSettings = read("lib/settings.ts")
  assert.match(brandSettings, /invoiceLogoUrl: appearance\.invoiceLogoUrl \|\| general\.invoiceLogoUrl/)
  assert.match(brandSettings, /logoUrl: appearance\.logoUrl \|\| general\.logoUrl/)
  assert.match(brandSettings, /footerLogoUrl: appearance\.footerLogoUrl \|\| general\.footerLogoUrl/)
  assert.match(brandSettings, /openGraphImageUrl: appearance\.openGraphImageUrl \|\| general\.openGraphImageUrl/)
})

test("invoice view model inherits invoice logo from site settings", () => {
  const viewModel = read("lib/invoices/invoice-view-model.ts")
  assert.match(viewModel, /logoUrl: site\.invoiceLogoUrl \|\| site\.logoUrl/)
  const browserTemplate = read("components/invoice/invoice-document.tsx")
  assert.match(browserTemplate, /invoice\.company\.logoUrl/)
  const pdfTemplate = read("components/invoice/invoice-pdf-template.tsx")
  assert.match(pdfTemplate, /invoice\.company\.logoUrl/)
})