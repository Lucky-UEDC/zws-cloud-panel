import { NextResponse } from "next/server"
import { getNavigationCategories } from "@/lib/catalog"

export async function GET() {
  const categories = await getNavigationCategories()

  return NextResponse.json({
    categories: categories.map((category) => ({
      id: category.id,
      slug: category.slug,
      title: category.title,
      dropdownBehavior: category.dropdownBehavior,
      children: category.children.map((child) => ({
        id: child.id,
        slug: child.slug,
        title: child.title,
      })),
    })),
  })
}
