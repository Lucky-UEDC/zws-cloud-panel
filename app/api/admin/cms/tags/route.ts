import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { slugify } from "@/lib/cms"
import { requireCmsAdmin } from "../_auth"

export async function GET() {
  const { response } = await requireCmsAdmin()
  if (response) return response
  const tags = await (prisma as any).cmsTag.findMany({
    include: { _count: { select: { posts: true } } },
    orderBy: { name: "asc" },
  }).catch(() => [])
  return NextResponse.json({ ok: true, tags })
}

export async function POST(request: NextRequest) {
  const { response } = await requireCmsAdmin()
  if (response) return response
  const body = await request.json().catch(() => ({}))
  const name = String(body.name || "").trim()
  if (!name) return NextResponse.json({ ok: false, error: "Tag name is required" }, { status: 400 })
  const tag = await (prisma as any).cmsTag.upsert({
    where: { slug: slugify(body.slug || name) },
    update: { name, description: body.description || null, seoTitle: body.seoTitle || null, seoDescription: body.seoDescription || null },
    create: { name, slug: slugify(body.slug || name), description: body.description || null, seoTitle: body.seoTitle || null, seoDescription: body.seoDescription || null },
  })
  return NextResponse.json({ ok: true, tag })
}

export async function PATCH(request: NextRequest) {
  const { response } = await requireCmsAdmin()
  if (response) return response
  const body = await request.json().catch(() => ({}))
  const sourceId = String(body.sourceId || "")
  const targetId = String(body.targetId || "")
  if (!sourceId || !targetId || sourceId === targetId) return NextResponse.json({ ok: false, error: "Source and target tags are required" }, { status: 400 })
  const joins = await (prisma as any).blogPostTag.findMany({ where: { tagId: sourceId } }).catch(() => [])
  await (prisma as any).blogPostTag.createMany({ data: joins.map((join: any) => ({ postId: join.postId, tagId: targetId })), skipDuplicates: true })
  await (prisma as any).cmsTag.delete({ where: { id: sourceId } })
  return NextResponse.json({ ok: true })
}
