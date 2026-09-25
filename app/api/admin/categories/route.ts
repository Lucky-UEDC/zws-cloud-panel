import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getAdminFromCookies } from "@/lib/server-auth"
import { slugify, validateCatalogSlug } from "@/lib/catalog"
import { canManageCatalog } from "@/lib/admin-rbac"
import { revalidateProductSurfaces } from "@/lib/product-revalidation"
import { requireAdminFullAuth } from "@/lib/auth/guards"

export async function GET(request: NextRequest) {
  const auth = await requireAdminFullAuth(request)
  if (!auth.ok) return auth.response
  const admin = { email: auth.session.email, role: auth.session.role }
  if (!admin.email || !canManageCatalog(admin.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const categories = await prisma.catalogCategory.findMany({
    orderBy: [{ parentId: "asc" }, { sortOrder: "asc" }, { title: "asc" }],
    include: {
      parent: { select: { id: true, title: true, slug: true } },
      children: { orderBy: [{ sortOrder: "asc" }, { title: "asc" }] },
      _count: { select: { products: true, subcategoryProducts: true, children: true } },
    },
  })

  return NextResponse.json({ categories })
}

export async function POST(request: NextRequest) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canManageCatalog(admin.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await request.json()
  const title = String(body.title || "").trim()
  if (!title) {
    return NextResponse.json({ error: "Title is required" }, { status: 400 })
  }

  try {
    const slug = validateCatalogSlug(String(body.slug || title))
    const category = await prisma.catalogCategory.create({
      data: {
        parentId: body.parentId || null,
        title,
        slug,
        description: body.description ? String(body.description) : null,
        icon: body.icon ? String(body.icon) : null,
        sortOrder: Number(body.sortOrder || 0),
        isActive: body.isActive !== false,
        showInNav: body.showInNav !== false,
        showLandingPage: body.showLandingPage !== false,
        dropdownBehavior: body.dropdownBehavior ? String(body.dropdownBehavior) : "auto",
        visibility: body.visibility ? String(body.visibility) : "public",
        metadata: body.metadata && typeof body.metadata === "object" ? body.metadata : {},
      },
    })
    revalidateProductSurfaces()
    return NextResponse.json({ success: true, category }, { status: 201 })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create category" },
      { status: 400 },
    )
  }
}
