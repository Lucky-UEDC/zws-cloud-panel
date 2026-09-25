import { prisma } from "@/lib/db"
import { blogPosts as staticBlogPosts } from "@/lib/data/blog-posts"

export function slugify(value: string) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "post"
}

export function isPublishedPostWhere(now = new Date()) {
  return {
    status: "published",
    OR: [{ publishedAt: null }, { publishedAt: { lte: now } }],
    AND: [{ OR: [{ scheduledAt: null }, { scheduledAt: { lte: now } }] }],
  }
}

export async function listPublishedBlogPosts() {
  const rows = await (prisma as any).blogPost.findMany({
    where: isPublishedPostWhere(),
    include: { category: true, tags: { include: { tag: true } }, featuredImage: true, ogImage: true },
    orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
  }).catch(() => [])
  if (rows.length) return rows
  return staticBlogPosts.map((post) => ({
    id: post.slug,
    slug: post.slug,
    title: post.title,
    excerpt: post.description,
    seoTitle: post.title,
    seoDescription: post.description,
    contentHtml: "",
    markdown: "",
    status: "published",
    publishedAt: new Date(post.publishedAt),
    canonicalUrl: post.canonicalPath,
    robots: "index, follow",
    schemaJson: {},
    tags: post.keywords.map((keyword) => ({ tag: { id: keyword, name: keyword, slug: slugify(keyword) } })),
    category: null,
    featuredImage: null,
    ogImage: null,
  }))
}

export async function getPublishedBlogPost(slug: string) {
  const row = await (prisma as any).blogPost.findFirst({
    where: { slug, ...isPublishedPostWhere() },
    include: { category: true, tags: { include: { tag: true } }, featuredImage: true, ogImage: true },
  }).catch(() => null)
  if (row) return row
  const staticPost = staticBlogPosts.find((post) => post.slug === slug)
  if (!staticPost) return null
  return {
    id: staticPost.slug,
    slug: staticPost.slug,
    title: staticPost.title,
    excerpt: staticPost.description,
    seoTitle: staticPost.title,
    seoDescription: staticPost.description,
    contentHtml: "",
    markdown: "",
    status: "published",
    publishedAt: new Date(staticPost.publishedAt),
    canonicalUrl: staticPost.canonicalPath,
    robots: "index, follow",
    schemaJson: {},
    tags: staticPost.keywords.map((keyword) => ({ tag: { id: keyword, name: keyword, slug: slugify(keyword) } })),
    category: null,
    featuredImage: null,
    ogImage: null,
  }
}

export function markdownFromHtml(html: string) {
  return String(html || "")
    .replace(/<h1[^>]*>(.*?)<\/h1>/gi, "# $1\n\n")
    .replace(/<h2[^>]*>(.*?)<\/h2>/gi, "## $1\n\n")
    .replace(/<h3[^>]*>(.*?)<\/h3>/gi, "### $1\n\n")
    .replace(/<blockquote[^>]*>(.*?)<\/blockquote>/gi, "> $1\n\n")
    .replace(/<li[^>]*>(.*?)<\/li>/gi, "- $1\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}
