import type { Metadata } from "next"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { SiteShell } from "@/components/layout/site-shell"
import { PageHeader } from "@/components/layout/page-header"
import { Container } from "@/components/layout/container"
import { CTASection } from "@/components/cta-section"
import { getPublishedBlogPost } from "@/lib/cms"
import { absoluteUrl, breadcrumbJsonLd } from "@/lib/seo"

type Props = {
  params: Promise<{ slug: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const post = await getPublishedBlogPost(slug)
  if (!post) return {}
  const canonicalPath = post.canonicalUrl || `/blog/${post.slug}`

  return {
    title: post.seoTitle || post.title,
    description: post.seoDescription || post.excerpt || "",
    alternates: { canonical: canonicalPath.startsWith("http") ? canonicalPath : absoluteUrl(canonicalPath) },
    robots: post.robots || "index, follow",
    openGraph: {
      title: post.seoTitle || post.title,
      description: post.seoDescription || post.excerpt || "",
      url: canonicalPath.startsWith("http") ? canonicalPath : absoluteUrl(canonicalPath),
      images: post.ogImage?.publicUrl || post.featuredImage?.publicUrl ? [absoluteUrl(post.ogImage?.publicUrl || post.featuredImage?.publicUrl)] : undefined,
      type: "article",
    },
  }
}

export default async function BlogPostPage({ params }: Props) {
  const { slug } = await params
  const post = await getPublishedBlogPost(slug)
  if (!post) notFound()
  const canonicalPath = post.canonicalUrl || `/blog/${post.slug}`

  const breadcrumbs = breadcrumbJsonLd([
    { name: "Home", path: "/" },
    { name: "Blog", path: "/blog" },
    { name: post.title, path: canonicalPath },
  ])

  return (
    <SiteShell>
      <PageHeader eyebrow={post.category?.name || "Blog"} title={post.title} description={post.excerpt || post.seoDescription || ""} />

      <section className="py-10">
        <Container className="space-y-10">
          <div className="glass rounded-2xl p-6 sm:p-10">
            <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
              <span>Published: {post.publishedAt ? new Date(post.publishedAt).toISOString().slice(0, 10) : ""}</span>
              <Link href="/vps-hosting" className="text-accent hover:underline">
                Launch an instance
              </Link>
            </div>

            <article className="mt-6 space-y-6">
              {post.contentHtml ? <div className="prose prose-invert max-w-none" dangerouslySetInnerHTML={{ __html: post.contentHtml }} /> : renderPostBody(post.slug)}
            </article>
          </div>

          <div className="glass rounded-2xl p-6 sm:p-8">
            <h2 className="text-xl font-semibold tracking-tight">Next steps</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Compare plans and deploy in minutes, or talk to an engineer if you need help sizing.
            </p>
            <div className="mt-4 flex flex-col gap-3 sm:flex-row">
              <Link href="/vps-hosting" className="inline-flex items-center justify-center rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground">
                View plans
              </Link>
              <Link href="/cloud-vps" className="inline-flex items-center justify-center rounded-md border border-border/60 px-4 py-2 text-sm font-medium">
                Explore compute instances
              </Link>
              <Link href="/contact" className="inline-flex items-center justify-center rounded-md border border-border/60 px-4 py-2 text-sm font-medium">
                Talk to an engineer
              </Link>
            </div>
          </div>
        </Container>
      </section>

      <CTASection />

      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbs) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(Object.keys(post.schemaJson || {}).length ? post.schemaJson : {
        "@context": "https://schema.org",
        "@type": "Article",
        headline: post.title,
        description: post.seoDescription || post.excerpt || "",
        datePublished: post.publishedAt,
      }) }} />
    </SiteShell>
  )
}

function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="text-xl font-semibold tracking-tight">{children}</h2>
}

function H3({ children }: { children: React.ReactNode }) {
  return <h3 className="text-base font-semibold tracking-tight">{children}</h3>
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-sm leading-6 text-muted-foreground">{children}</p>
}

function Ul({ items }: { items: string[] }) {
  return (
    <ul className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
      {items.map((t) => (
        <li key={t} className="rounded-xl bg-foreground/[0.04] p-3">
          {t}
        </li>
      ))}
    </ul>
  )
}

function renderPostBody(slug: string) {
  switch (slug) {
    case "what-is-vps-hosting":
      return (
        <>
          <H2>What a compute instance is (in plain terms)</H2>
          <P>
            A compute instance is a virtual machine that behaves like a dedicated server for your workload.
            You get isolated resources, root access, and a predictable environment compared to shared hosting.
          </P>
          <H2>When compute instances are the right choice</H2>
          <Ul
            items={[
              "You need root access to install packages or run Docker.",
              "Your app outgrew shared hosting performance limits.",
              "You want predictable resource allocation and upgrade paths.",
              "You need a stable server for staging, CI, or internal tools.",
            ]}
          />
          <H2>Specs that actually matter</H2>
          <H3>CPU and performance consistency</H3>
          <P>
            A “bigger” CPU spec is not useful if performance is inconsistent. Look for clear CPU core allocation and
            transparent plan tiers.
          </P>
          <H3>RAM sizing</H3>
          <P>
            RAM affects cache and concurrency. Under-sizing RAM is one of the fastest ways to hit slowdowns on modern
            stacks.
          </P>
          <H3>NVMe storage</H3>
          <P>
            NVMe can improve database I/O, build times, and general responsiveness, especially for write-heavy workloads.
          </P>
          <H2>Deploy in minutes</H2>
          <P>
            If you want to skip the guesswork, start from a plan and scale as traffic grows.
            {" "}
            <Link href="/vps-hosting" className="text-accent hover:underline">
              View Cloud Instance plans
            </Link>.
          </P>
        </>
      )

    case "vps-vs-cloud-hosting":
      return (
        <>
          <H2>The real difference</H2>
          <P>
            Compute instance plans usually mean a single VM with fixed resources. Cloud hosting is typically built for elasticity:
            scaling resources up and down, and distributing workloads across infrastructure.
          </P>
          <H2>Choose compute instances when</H2>
          <Ul
            items={[
              "You want predictable monthly cost and specs.",
              "Your workload is steady (APIs, SaaS, WordPress, internal tools).",
              "You prefer simplicity over distributed architecture.",
              "You want a reliable, single-server deployment model.",
            ]}
          />
          <H2>Choose Cloud when</H2>
          <Ul
            items={[
              "You need scaling patterns (bursty traffic, multiple services).",
              "You want options for multi-node or HA setups.",
              "You need to separate concerns across services more cleanly.",
              "You are planning for higher availability requirements.",
            ]}
          />
          <H2>Quick decision rule</H2>
          <P>
            Start with compute instances if you are early-stage and want speed plus predictable billing. Move to cloud as you outgrow a
            single-node model or need resilience patterns.
          </P>
          <P>
            Browse
            {" "}
            <Link href="/vps-hosting" className="text-accent hover:underline">
              Compute Instances
            </Link>
            {" "}
            or
            {" "}
            <Link href="/cloud-vps" className="text-accent hover:underline">
              Compute Instances
            </Link>.
          </P>
        </>
      )

    case "deploy-proxmox-server":
      redirect("/blog/deploy-virtualization-server")

    case "deploy-virtualization-server":
      return (
        <>
          <H2>What you need before you start</H2>
          <Ul
            items={[
              "A server (bare metal or a lab box) with virtualization support enabled.",
              "A clean network plan (bridge vs NAT, IP ranges, DNS).",
              "Storage plan (ZFS vs LVM) based on your I/O needs.",
              "A backup strategy (snapshots are not backups).",
            ]}
          />
          <H2>High-level steps</H2>
          <Ul
            items={[
              "Install your virtualization platform and apply all security updates.",
              "Configure networking (bridges, VLANs if needed).",
              "Set up storage pools and ISO/templates.",
              "Create a baseline VM template to deploy quickly.",
              "Configure backups and test restores.",
            ]}
          />
          <H2>Where an instance fits</H2>
          <P>
            Many teams run virtualization labs for dev/test, or small internal clusters. If you are evaluating infrastructure,
            start with a fast compute instance for your supporting services, monitoring, or control-plane tooling.
            {" "}
            <Link href="/compute-instances" className="text-accent hover:underline">
              See compute instance options
            </Link>.
          </P>
        </>
      )

    case "best-vps-for-startups":
      return (
        <>
          <H2>Start with your workload, not your budget</H2>
          <P>
            The cheapest plan is rarely the best choice if it forces premature migrations or performance firefighting.
            Choose a baseline that supports stable response times and healthy headroom.
          </P>
          <H2>Checklist</H2>
          <Ul
            items={[
              "NVMe storage for database-heavy apps.",
              "A clear upgrade path with predictable pricing.",
              "Backups and snapshots (and a tested restore plan).",
              "DDoS protection and basic security hygiene.",
              "Support you can actually reach when production is down.",
            ]}
          />
          <H2>Managed vs unmanaged</H2>
          <P>
            If you do not have an on-call rotation, managed instances can be cheaper than downtime. It is a good fit when you
            want patching, monitoring, and best-practice hardening.
            {" "}
            <Link href="/managed-vps" className="text-accent hover:underline">
              Explore managed instances
            </Link>.
          </P>
        </>
      )

    case "nvme-vs-ssd-vps-performance":
      return (
        <>
          <H2>What changes with NVMe</H2>
          <P>
            NVMe reduces latency and increases throughput compared to older SATA SSDs. You usually feel the difference in
            database responsiveness, queue depth under load, and build or deploy times.
          </P>
          <H2>Workloads that benefit most</H2>
          <Ul
            items={[
              "relational databases and search indexes.",
              "CI builds, Docker image builds, and package installs.",
              "High request rate apps with frequent writes.",
              "Caching layers that spill to disk under pressure.",
            ]}
          />
          <H2>Affordable instances and performance</H2>
          <P>
            Affordable plans can still be fast when storage and CPU allocation are fair. Start with an entry plan and
            upgrade based on metrics, not guesses.
            {" "}
            <Link href="/cheap-vps" className="text-accent hover:underline">
              View affordable plans
            </Link>.
          </P>
        </>
      )

    default:
      return null
  }
}
