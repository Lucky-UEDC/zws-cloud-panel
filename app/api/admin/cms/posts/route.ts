import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { createPanelLog } from "@/lib/panel-log"
import { markdownFromHtml, slugify } from "@/lib/cms"
import { requireCmsAdmin } from "../_auth"

function cleanDate(value: unknown) {
  const text = String(value || "").trim()
  if (!text) return null
  const date = new Date(text)
  return Number.isNaN(date.getTime()) ? null : date
}

function postData(body: any, admin: any) {
  const title = String(body.title || "Untitled post").trim()
  const contentHtml = String(body.contentHtml || "")
  return {
    title,
    slug: slugify(body.slug || title),
    excerpt: body.excerpt ? String(body.excerpt) : null,
    contentJson: body.contentJson && typeof body.contentJson === "object" ? body.contentJson : {},
    contentHtml,
    markdown: String(body.markdown || markdownFromHtml(contentHtml)),
    status: ["draft", "published", "scheduled"].includes(String(body.status)) ? String(body.status) : "draft",
    scheduledAt: cleanDate(body.scheduledAt),
    publishedAt: cleanDate(body.publishedAt) || (body.status === "published" ? new Date() : null),
    featuredImageId: body.featuredImageId || null,
    categoryId: body.categoryId || null,
    authorId: String(admin.sub || ""),
    authorEmail: String(admin.email || ""),
    seoTitle: body.seoTitle ? String(body.seoTitle) : null,
    seoDescription: body.seoDescription ? String(body.seoDescription) : null,
    ogImageId: body.ogImageId || null,
    canonicalUrl: body.canonicalUrl ? String(body.canonicalUrl) : null,
    robots: body.robots ? String(body.robots) : "index, follow",
    schemaJson: body.schemaJson && typeof body.schemaJson === "object" ? body.schemaJson : {},
  }
}

export async function GET(request: NextRequest) {
  const { response } = await requireCmsAdmin()
  if (response) return response
  const status = request.nextUrl.searchParams.get("status")
  const posts = await (prisma as any).blogPost.findMany({
    where: status && status !== "all" ? { status } : {},
    include: { category: true, tags: { include: { tag: true } }, featuredImage: true, ogImage: true },
    orderBy: [{ updatedAt: "desc" }],
    take: 100,
  }).catch(() => [])
  return NextResponse.json({ ok: true, posts })
}

export async function POST(request: NextRequest) {
  const { admin, response } = await requireCmsAdmin()
  if (response) return response
  const body = await request.json().catch(() => ({}))
  const data = postData(body, admin)
  const post = await (prisma as any).blogPost.create({ data })
  await createPanelLog({ category: "SEO", message: "blog_post_created", actorType: "admin", actorEmail: String(admin?.email), metadata: { postId: post.id, slug: post.slug } }).catch(() => null)
  return NextResponse.json({ ok: true, post })
}
