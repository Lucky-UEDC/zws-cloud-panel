import { prisma } from "@/lib/db"

export const RESERVED_CATALOG_SLUGS = new Set([
  "about",
  "abuse",
  "admin",
  "api",
  "client-area",
  "compliance",
  "configure",
  "contact",
  "faq",
  "features",
  "forgot-password",
  "infrastructure",
  "invoice",
  "legal",
  "login",
  "logout",
  "maintenance",
  "payment",
  "pricing",
  "register",
  "reset-password",
  "robots.txt",
  "sitemap.xml",
  "status",
  "support",
  "support-agent",
  "zwsloginsam",
])

export function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

export function validateCatalogSlug(slug: string, currentSlug?: string | null) {
  const normalized = slugify(slug)
  if (!normalized) {
    throw new Error("Slug is required")
  }
  if (normalized !== currentSlug && RESERVED_CATALOG_SLUGS.has(normalized)) {
    throw new Error(`The slug "${normalized}" is reserved for a system route`)
  }
  return normalized
}

export async function getNavigationCategories() {
  return prisma.catalogCategory.findMany({
    where: {
      isActive: true,
      showInNav: true,
      visibility: "public",
      parentId: null,
    },
    orderBy: [{ sortOrder: "asc" }, { title: "asc" }],
    include: {
      children: {
        where: {
          isActive: true,
          showInNav: true,
          visibility: "public",
        },
        orderBy: [{ sortOrder: "asc" }, { title: "asc" }],
      },
    },
  })
}

export async function getCategoryBySlug(slug: string) {
  return prisma.catalogCategory.findFirst({
    where: {
      slug,
      isActive: true,
      parentId: null,
      visibility: "public",
    },
    include: {
      children: {
        where: { isActive: true, visibility: "public" },
        orderBy: [{ sortOrder: "asc" }, { title: "asc" }],
      },
    },
  })
}

export async function getSubcategoryBySlug(parentSlug: string, childSlug: string) {
  return prisma.catalogCategory.findFirst({
    where: {
      slug: childSlug,
      isActive: true,
      visibility: "public",
      parent: {
        slug: parentSlug,
        isActive: true,
        visibility: "public",
      },
    },
    include: {
      parent: true,
    },
  })
}
