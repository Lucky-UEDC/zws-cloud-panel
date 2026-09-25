"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { readJsonResponse } from "@/lib/client/safe-json"

export default function CmsPostsPage() {
  const [posts, setPosts] = useState<any[]>([])

  async function load() {
    const res = await fetch("/api/admin/cms/posts", { cache: "no-store" })
    const data = await readJsonResponse<any>(res).catch(() => ({}))
    if (res.ok) setPosts(data.posts || [])
  }

  useEffect(() => {
    void load()
  }, [])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold">Blog CMS</h1>
          <p className="mt-1 text-sm text-muted-foreground">Manage drafts, scheduled articles, tags, SEO, and media.</p>
        </div>
        <Button asChild className="gap-2"><Link href="/admin/cms/posts/new"><Plus className="h-4 w-4" />New post</Link></Button>
      </div>
      <Card className="glass border-border/40">
        <CardHeader><CardTitle>Posts</CardTitle><CardDescription>{posts.length} articles</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          {posts.map((post) => (
            <Link key={post.id} href={`/admin/cms/posts/${post.id}`} className="block rounded-lg border border-border/40 bg-background/35 p-4 transition-colors hover:bg-[rgba(20,184,166,0.12)]">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-medium text-white">{post.title}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">/{post.slug}</p>
                </div>
                <Badge variant="outline">{String(post.status || "draft").toUpperCase()}</Badge>
              </div>
              {post.excerpt ? <p className="mt-2 text-sm text-muted-foreground">{post.excerpt}</p> : null}
            </Link>
          ))}
          {!posts.length ? (
            <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
              <p className="text-sm font-medium">No blog posts created yet.</p>
              <p className="max-w-sm text-sm text-muted-foreground">Start with a draft, add SEO metadata, then publish when it is ready.</p>
              <Button asChild className="gap-2"><Link href="/admin/cms/posts/new"><Plus className="h-4 w-4" />Create first post</Link></Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
