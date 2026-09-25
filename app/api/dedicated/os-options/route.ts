import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getDedicatedOsOptions } from "@/lib/dedicated"
import { getPublicProductsWhere } from "@/lib/public-products"

export const dynamic = "force-dynamic"

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const productRef = searchParams.get("product")
  const product = productRef
    ? await prisma.product.findFirst({
        where: {
          ...getPublicProductsWhere(),
          OR: [{ id: productRef }, { slug: productRef }],
          type: "dedicated",
        },
      })
    : null
  const options = await getDedicatedOsOptions(product)
  return NextResponse.json({ success: true, options }, { headers: NO_STORE_HEADERS })
}
