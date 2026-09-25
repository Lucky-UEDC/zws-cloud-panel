import Link from "next/link"
import { redirect } from "next/navigation"
import { CalendarClock, FileText, FolderTree, ImageIcon, PencilLine, Tags } from "lucide-react"
import { prisma } from "@/lib/db"
import { getAdminFromCookies } from "@/lib/server-auth"
import { canManageCms } from "@/lib/admin-rbac"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

export default async function CmsDashboardPage() {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canManageCms(admin.role)) redirect("/403")

  const [totalPosts, published, drafts, scheduled, totalTags, totalCategories, mediaCount, recentPublished, recentEdits, scheduledPosts] = await Promise.all([
    (prisma as any).blogPost.count().catch(() => 0),
    (prisma as any).blogPost.count({ where: { status: "published" } }).catch(() => 0),
    (prisma as any).blogPost.count({ where: { status: "draft" } }).catch(() => 0),
    (prisma as any).blogPost.count({ where: { status: "scheduled" } }).catch(() => 0),
    (prisma as any).cmsTag.count().catch(() => 0),
    (prisma as any).cmsCategory.count().catch(() => 0),
    (prisma as any).cmsMediaAsset.count({ where: { deletedAt: null } }).catch(() => 0),
    (prisma as any).blogPost.findMany({ where: { status: "published" }, orderBy: { publishedAt: "desc" }, take: 5 }).catch(() => []),
    (prisma as any).blogPost.findMany({ orderBy: { updatedAt: "desc" }, take: 5 }).catch(() => []),
    (prisma as any).blogPost.findMany({ where: { status: "scheduled" }, orderBy: { scheduledAt: "asc" }, take: 5 }).catch(() => []),
  ])

  const stats = [
    { label: "Total posts", value: totalPosts, icon: FileText },
    { label: "Published", value: published, icon: PencilLine },
    { label: "Drafts", value: drafts, icon: FileText },
    { label: "Scheduled", value: scheduled, icon: CalendarClock },
    { label: "Total tags", value: totalTags, icon: Tags },
    { label: "Total categories", value: totalCategories, icon: FolderTree },
    { label: "Media count", value: mediaCount, icon: ImageIcon },
  ]

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold">CMS Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">Overview of blog content, media, tags, categories, and scheduled publishing.</p>
        </div>
        <Button asChild><Link href="/admin/cms/posts/new">Create post</Link></Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.label} className="glass border-border/40">
            <CardContent className="flex items-center justify-between p-4">
              <div>
                <p className="text-sm text-muted-foreground">{stat.label}</p>
                <p className="mt-1 text-2xl font-semibold">{stat.value}</p>
              </div>
              <stat.icon className="h-5 w-5 text-accent" />
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <ActivityCard title="Recently published" posts={recentPublished} empty="No published posts yet." />
        <ActivityCard title="Recent edits" posts={recentEdits} empty="No recent edits yet." />
        <ActivityCard title="Scheduled posts" posts={scheduledPosts} empty="No scheduled posts." />
      </div>
    </div>
  )
}

function ActivityCard({ title, posts, empty }: { title: string; posts: any[]; empty: string }) {
  return (
    <Card className="glass border-border/40">
      <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {posts.map((post) => (
          <Link key={post.id} href={`/admin/cms/posts/${post.id}`} className="block rounded-lg border border-border/40 bg-background/35 p-3 transition-colors hover:bg-[rgba(20,184,166,0.12)]">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-medium">{post.title}</p>
                <p className="mt-1 truncate text-xs text-muted-foreground">/{post.slug}</p>
              </div>
              <Badge variant="outline">{String(post.status || "draft")}</Badge>
            </div>
          </Link>
        ))}
        {!posts.length ? <p className="py-6 text-center text-sm text-muted-foreground">{empty}</p> : null}
      </CardContent>
    </Card>
  )
}
