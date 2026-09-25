import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getAdminFromCookies } from "@/lib/server-auth"
import { validateCatalogSlug } from "@/lib/catalog"
import { canManageCatalog } from "@/lib/admin-rbac"
import { revalidateProductSurfaces } from "@/lib/product-revalidation"

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canManageCatalog(admin.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const body = await request.json()
  const current = await prisma.catalogCategory.findUnique({ where: { id } })
  if (!current) return NextResponse.json({ error: "Category not found" }, { status: 404 })

  try {
    const slug = validateCatalogSlug(String(body.slug || current.slug), current.slug)
    const category = await prisma.catalogCategory.update({
      where: { id },
      data: {
        parentId: Object.prototype.hasOwnProperty.call(body, "parentId") ? body.parentId || null : undefined,
        title: typeof body.title === "string" ? body.title.trim() : undefined,
        slug,
        description: Object.prototype.hasOwnProperty.call(body, "description") ? (body.description ? String(body.description) : null) : undefined,
        icon: Object.prototype.hasOwnProperty.call(body, "icon") ? (body.icon ? String(body.icon) : null) : undefined,
        sortOrder: Object.prototype.hasOwnProperty.call(body, "sortOrder") ? Number(body.sortOrder || 0) : undefined,
        isActive: typeof body.isActive === "boolean" ? body.isActive : undefined,
        showInNav: typeof body.showInNav === "boolean" ? body.showInNav : undefined,
        showLandingPage: typeof body.showLandingPage === "boolean" ? body.showLandingPage : undefined,
        dropdownBehavior: typeof body.dropdownBehavior === "string" ? body.dropdownBehavior : undefined,
        visibility: typeof body.visibility === "string" ? body.visibility : undefined,
        metadata: body.metadata && typeof body.metadata === "object" ? body.metadata : undefined,
      },
    })
    revalidateProductSurfaces()
    return NextResponse.json({ success: true, category })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update category" },
      { status: 400 },
    )
  }
}

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canManageCatalog(admin.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const category = await prisma.catalogCategory.findUnique({
    where: { id },
    include: { children: true, products: true, subcategoryProducts: true },
  })

  if (!category) return NextResponse.json({ error: "Category not found" }, { status: 404 })

  if (category.children.length || category.products.length || category.subcategoryProducts.length) {
    return NextResponse.json(
      { error: "Reassign or delete linked subcategories/products before deleting this category" },
      { status: 400 },
    )
  }

  await prisma.catalogCategory.delete({ where: { id } })
  revalidateProductSurfaces()
  return NextResponse.json({ success: true })
}
