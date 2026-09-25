import type { Metadata } from "next"
import Link from "next/link"
import { SiteShell } from "@/components/layout/site-shell"
import { PageHeader } from "@/components/layout/page-header"
import { Container } from "@/components/layout/container"
import { CTASection } from "@/components/cta-section"
import { listPublishedBlogPosts } from "@/lib/cms"

export const metadata: Metadata = {
  title: "Blog",
  description: "Compute instance and cloud hosting guides, comparisons, and practical tutorials.",
}

export default async function BlogIndexPage() {
  const posts = await listPublishedBlogPosts()

  return (
    <SiteShell>
      <PageHeader
        eyebrow="Blog"
        title="Guides that ship."
        description="Practical compute instance and cloud hosting tutorials focused on deployment, performance, and real buying decisions."
      />

      <section className="py-16">
        <Container className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {posts.map((post: any) => (
            <Link
              key={post.slug}
              href={`/blog/${post.slug}`}
              className="glass glass-hover block rounded-2xl p-6"
            >
              <div className="text-xs text-muted-foreground">{post.publishedAt ? new Date(post.publishedAt).toISOString().slice(0, 10) : ""}</div>
              <h2 className="mt-2 text-lg font-semibold tracking-tight">{post.title}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{post.excerpt || post.seoDescription}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {(post.tags || []).slice(0, 3).map((item: any) => (
                  <span key={item.tag?.id || item.tag?.slug} className="rounded-full bg-foreground/[0.04] px-3 py-1 text-xs text-muted-foreground">
                    {item.tag?.name}
                  </span>
                ))}
              </div>
            </Link>
          ))}
        </Container>
      </section>

      <CTASection />
    </SiteShell>
  )
}
