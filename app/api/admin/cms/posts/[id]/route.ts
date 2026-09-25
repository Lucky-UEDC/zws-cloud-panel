import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { createPanelLog } from "@/lib/panel-log"
import { markdownFromHtml, slugify } from "@/lib/cms"
import { requireCmsAdmin } from "../../_auth"

function cleanDate(value: unknown) {
  const text = String(value || "").trim()
  if (!text) return null
  const date = new Date(text)
  return Number.isNaN(date.getTime()) ? null : date
}

function dataFromBody(body: any) {
  const contentHtml = String(body.contentHtml || "")
  const data: Record<string, unknown> = {
    title: String(body.title || "Untitled post").trim(),
    slug: slugify(body.slug || body.title),
    excerpt: body.excerpt ? String(body.excerpt) : null,
    contentJson: body.contentJson && typeof body.contentJson === "object" ? body.contentJson : {},
    contentHtml,
    markdown: String(body.markdown || markdownFromHtml(contentHtml)),
    status: ["draft", "published", "scheduled"].includes(String(body.status)) ? String(body.status) : "draft",
    scheduledAt: cleanDate(body.scheduledAt),
    publishedAt: cleanDate(body.publishedAt) || (body.status === "published" ? new Date() : null),
    featuredImageId: body.featuredImageId || null,
    categoryId: body.categoryId || null,
    seoTitle: body.seoTitle ? String(body.seoTitle) : null,
    seoDescription: body.seoDescription ? String(body.seoDescription) : null,
    ogImageId: body.ogImageId || null,
    canonicalUrl: body.canonicalUrl ? String(body.canonicalUrl) : null,
    robots: body.robots ? String(body.robots) : "index, follow",
    schemaJson: body.schemaJson && typeof body.schemaJson === "object" ? body.schemaJson : {},
  }
  return data
}

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { response } = await requireCmsAdmin()
  if (response) return response
  const { id } = await params
  const post = await (prisma as any).blogPost.findUnique({
    where: { id },
    include: { category: true, tags: { include: { tag: true } }, featuredImage: true, ogImage: true },
  })
  if (!post) return NextResponse.json({ ok: false, error: "Post not found" }, { status: 404 })
  return NextResponse.json({ ok: true, post })
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { admin, response } = await requireCmsAdmin()
  if (response) return response
  const { id } = await params
  const body = await request.json().catch(() => ({}))
  const post = await (prisma as any).blogPost.update({ where: { id }, data: dataFromBody(body) })
  if (Array.isArray(body.tagIds)) {
    await (prisma as any).blogPostTag.deleteMany({ where: { postId: id } })
    await (prisma as any).blogPostTag.createMany({ data: body.tagIds.map((tagId: string) => ({ postId: id, tagId })), skipDuplicates: true })
  }
  await createPanelLog({ category: "SEO", message: "blog_post_updated", actorType: "admin", actorEmail: String(admin?.email), metadata: { postId: post.id, slug: post.slug } }).catch(() => null)
  return NextResponse.json({ ok: true, post })
}

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { response } = await requireCmsAdmin()
  if (response) return response
  const { id } = await params
  await (prisma as any).blogPost.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
