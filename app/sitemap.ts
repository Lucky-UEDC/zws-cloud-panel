import type { MetadataRoute } from "next"
import { siteConfig } from "@/lib/data/site"
import { listPublishedBlogPosts } from "@/lib/cms"
import { prisma } from "@/lib/db"
import { getCustomConfigurationSettings } from "@/lib/settings"
import { getSiteUrl } from "@/lib/settings/site-settings"
import { isComingSoonRoute } from "@/lib/coming-soon-routes"
import { getPublicProductsWhere } from "@/lib/public-products"
import { publicSitemapRoutes } from "@/lib/navigation"

export const dynamic = "force-dynamic"

const routes = publicSitemapRoutes

const blockedPrefixes = ["/admin", "/client-area", "/api", "/checkout", "/login", "/register", "/forgot-password", "/reset-password", "/verify-email", "/payment", "/invoice"]

function sitemapUrl(baseUrl: string, path: string, lastModified: Date, changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"], priority: number) {
  return {
    url: `${baseUrl}${path}`,
    lastModified,
    changeFrequency,
    priority,
  }
}

function isBlocked(path: string) {
  return blockedPrefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date()
  const [customSettings, siteUrl, publishedPosts] = await Promise.all([
    getCustomConfigurationSettings(),
    getSiteUrl().catch(() => siteConfig.url.replace(/\/$/, "")),
    listPublishedBlogPosts().catch(() => []),
  ])
  const baseUrl = siteUrl.replace(/\/$/, "")

  const staticRoutes = routes
    .filter((path) => !isBlocked(path))
    .filter((path) => !isComingSoonRoute(path))
    .filter((path) => customSettings.enableCustomConfiguration || path !== "/configure")
    .map((path) => sitemapUrl(baseUrl, path, now, path === "" ? "daily" : "monthly", path === "" ? 1 : 0.6))

  const blogRoutes = publishedPosts
    .map((post: any) => post.canonicalUrl && !String(post.canonicalUrl).startsWith("http") ? post.canonicalUrl : `/blog/${post.slug}`)
    .filter((path: string) => !isBlocked(path))
    .map((path: string) => sitemapUrl(baseUrl, path, now, "monthly", 0.55))

  const [offers, categories] = await Promise.all([
    prisma.offer.findMany({
      where: { active: true },
      select: { slug: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
    }).catch(() => []),
    prisma.catalogCategory.findMany({
      where: {
        isActive: true,
        visibility: "public",
        showLandingPage: true,
        OR: [
          { products: { some: getPublicProductsWhere() } },
          { subcategoryProducts: { some: getPublicProductsWhere() } },
        ],
      },
      select: {
        slug: true,
        updatedAt: true,
        parent: { select: { slug: true, isActive: true, visibility: true, showLandingPage: true } },
      },
      orderBy: { updatedAt: "desc" },
    }).catch(() => []),
  ])

  const offerRoutes = offers
    .filter((offer) => offer.slug)
    .map((offer) => sitemapUrl(baseUrl, `/offer/${offer.slug}`, offer.updatedAt, "weekly", 0.7))

  const categoryRoutes = categories
    .map((category) => {
      const parent = category.parent
      const path = parent?.isActive && parent.visibility === "public" && parent.showLandingPage
        ? `/${parent.slug}/${category.slug}`
        : `/${category.slug}`
      return sitemapUrl(baseUrl, path, category.updatedAt, "weekly", 0.65)
    })
    .filter((entry) => !isBlocked(new URL(entry.url).pathname))
    .filter((entry) => !isComingSoonRoute(new URL(entry.url).pathname))

  return [...staticRoutes, ...blogRoutes, ...offerRoutes, ...categoryRoutes]
}
