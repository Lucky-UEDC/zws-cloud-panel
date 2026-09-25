import { NextRequest, NextResponse } from "next/server"
import { BillingTerm } from "@/lib/pricing"
import { normalizeProductFamily } from "@/lib/catalog-product"
import { apiError } from "@/lib/api-response"
import { getPublicProducts } from "@/lib/public-products"

export const dynamic = "force-dynamic"

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const term = parseInt(searchParams.get("term") || "1") as BillingTerm
    const category = searchParams.get("category")
    const categorySlug = searchParams.get("categorySlug")
    const subcategorySlug = searchParams.get("subcategorySlug")
    const type = searchParams.get("type")
    const slug = searchParams.get("slug")
    const products = await getPublicProducts({ term, category, categorySlug, subcategorySlug, type, slug, request })

    console.info("[products] listing", {
      count: products.length,
      familyFilter: type ? normalizeProductFamily(type) : null,
      category,
      categorySlug,
      subcategorySlug,
      slug,
    })

    return NextResponse.json({ success: true, products, term }, { headers: NO_STORE_HEADERS })
  } catch (error) {
    console.error("Products API error:", error)
    return apiError("server_error", "Unable to load products right now.", 500)
  }
}
