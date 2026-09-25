import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { requireCmsAdmin } from "../_auth"

export async function GET() {
  const { response } = await requireCmsAdmin()
  if (response) return response
  const pages = await (prisma as any).seoPage.findMany({ orderBy: { path: "asc" } }).catch(() => [])
  return NextResponse.json({ ok: true, pages })
}

export async function POST(request: NextRequest) {
  const { admin, response } = await requireCmsAdmin()
  if (response) return response
  const body = await request.json().catch(() => ({}))
  const path = String(body.path || "").trim()
  if (!path.startsWith("/")) return NextResponse.json({ ok: false, error: "Path must start with /" }, { status: 400 })
  const page = await (prisma as any).seoPage.upsert({
    where: { path },
    update: {
      title: body.title || null,
      description: body.description || null,
      ogImage: body.ogImage || null,
      canonicalUrl: body.canonicalUrl || null,
      robots: body.robots || "index, follow",
      schemaJson: body.schemaJson && typeof body.schemaJson === "object" ? body.schemaJson : {},
      updatedBy: String(admin?.email || ""),
    },
    create: {
      path,
      title: body.title || null,
      description: body.description || null,
      ogImage: body.ogImage || null,
      canonicalUrl: body.canonicalUrl || null,
      robots: body.robots || "index, follow",
      schemaJson: body.schemaJson && typeof body.schemaJson === "object" ? body.schemaJson : {},
      updatedBy: String(admin?.email || ""),
    },
  })
  return NextResponse.json({ ok: true, page })
}
