import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { slugify } from "@/lib/cms"
import { requireCmsAdmin } from "../_auth"

export async function GET() {
  const { response } = await requireCmsAdmin()
  if (response) return response
  const categories = await (prisma as any).cmsCategory.findMany({ orderBy: { name: "asc" } }).catch(() => [])
  return NextResponse.json({ ok: true, categories })
}

export async function POST(request: NextRequest) {
  const { response } = await requireCmsAdmin()
  if (response) return response
  const body = await request.json().catch(() => ({}))
  const name = String(body.name || "").trim()
  if (!name) return NextResponse.json({ ok: false, error: "Category name is required" }, { status: 400 })
  const category = await (prisma as any).cmsCategory.upsert({
    where: { slug: slugify(body.slug || name) },
    update: { name, description: body.description || null, seoTitle: body.seoTitle || null, seoDescription: body.seoDescription || null },
    create: { name, slug: slugify(body.slug || name), description: body.description || null, seoTitle: body.seoTitle || null, seoDescription: body.seoDescription || null },
  })
  return NextResponse.json({ ok: true, category })
}
