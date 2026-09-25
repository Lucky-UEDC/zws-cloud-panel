"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Save } from "lucide-react"
import { CmsEditor } from "@/components/admin/cms-editor"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { readJsonResponse } from "@/lib/client/safe-json"

const emptyPost = {
  title: "",
  slug: "",
  excerpt: "",
  contentJson: {},
  contentHtml: "",
  markdown: "",
  status: "draft",
  scheduledAt: "",
  publishedAt: "",
  featuredImageId: "",
  categoryId: "",
  seoTitle: "",
  seoDescription: "",
  ogImageId: "",
  canonicalUrl: "",
  robots: "index, follow",
  schemaJsonText: "{}",
  tagIds: [] as string[],
}

type CmsPostFormState = Omit<typeof emptyPost, "contentJson"> & { contentJson: unknown }

export function CmsPostForm({ postId }: { postId?: string }) {
  const router = useRouter()
  const [post, setPost] = useState<CmsPostFormState>(emptyPost)
  const [categories, setCategories] = useState<any[]>([])
  const [tags, setTags] = useState<any[]>([])
  const [media, setMedia] = useState<any[]>([])

  useEffect(() => {
    async function load() {
      const [categoryRes, tagRes, mediaRes] = await Promise.all([
        fetch("/api/admin/cms/categories", { cache: "no-store" }),
        fetch("/api/admin/cms/tags", { cache: "no-store" }),
        fetch("/api/admin/cms/media", { cache: "no-store" }),
      ])
      const [categoryData, tagData, mediaData] = await Promise.all([categoryRes.json(), tagRes.json(), mediaRes.json()])
      setCategories(categoryData.categories || [])
      setTags(tagData.tags || [])
      setMedia(mediaData.assets || [])
      if (postId) {
        const res = await fetch(`/api/admin/cms/posts/${postId}`, { cache: "no-store" })
        const data = await readJsonResponse<any>(res)
        if (res.ok && data.post) {
          setPost({
            ...emptyPost,
            ...data.post,
            scheduledAt: data.post.scheduledAt ? data.post.scheduledAt.slice(0, 16) : "",
            publishedAt: data.post.publishedAt ? data.post.publishedAt.slice(0, 16) : "",
            featuredImageId: data.post.featuredImageId || "",
            categoryId: data.post.categoryId || "",
            ogImageId: data.post.ogImageId || "",
            schemaJsonText: JSON.stringify(data.post.schemaJson || {}, null, 2),
            tagIds: (data.post.tags || []).map((item: any) => item.tagId),
          })
        }
      }
    }
    void load()
  }, [postId])

  function update(key: string, value: any) {
    setPost((current) => ({ ...current, [key]: value }))
  }

  async function save() {
    let schemaJson = {}
    try {
      schemaJson = JSON.parse(post.schemaJsonText || "{}")
    } catch {
      toast.error("Schema JSON is invalid")
      return
    }
    const payload = {
      ...post,
      schemaJson,
      featuredImageId: post.featuredImageId || null,
      ogImageId: post.ogImageId || null,
      categoryId: post.categoryId || null,
      scheduledAt: post.scheduledAt || null,
      publishedAt: post.publishedAt || null,
    }
    const res = await fetch(postId ? `/api/admin/cms/posts/${postId}` : "/api/admin/cms/posts", {
      method: postId ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    const data = await readJsonResponse<any>(res)
    if (!res.ok) {
      toast.error(data?.error || "Could not save post")
      return
    }
    toast.success("Post saved")
    router.push(`/admin/cms/posts/${data.post?.id || postId}`)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold">{postId ? "Edit post" : "New post"}</h1>
          <p className="mt-1 text-sm text-muted-foreground">Write, schedule, publish, and optimize blog content.</p>
        </div>
        <Button onClick={save} className="gap-2"><Save className="h-4 w-4" />Save</Button>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <Card className="glass border-border/40">
          <CardHeader><CardTitle>Article</CardTitle><CardDescription>Rich editor with Markdown export.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <Field label="Title"><Input value={post.title} onChange={(event) => update("title", event.target.value)} /></Field>
            <Field label="Slug"><Input value={post.slug} onChange={(event) => update("slug", event.target.value)} placeholder="article-slug" /></Field>
            <Field label="Excerpt"><Textarea value={post.excerpt || ""} onChange={(event) => update("excerpt", event.target.value)} /></Field>
            <CmsEditor value={{ json: post.contentJson, html: post.contentHtml, markdown: post.markdown }} onChange={(value) => setPost((current) => ({ ...current, contentJson: value.json, contentHtml: value.html, markdown: value.markdown }))} />
            <Field label="Markdown export"><Textarea className="min-h-40 font-mono text-xs" value={post.markdown || ""} readOnly /></Field>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="glass border-border/40">
            <CardHeader><CardTitle>Publishing</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <Field label="Status"><Select value={post.status} onValueChange={(value) => update("status", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="draft">Draft</SelectItem><SelectItem value="scheduled">Scheduled</SelectItem><SelectItem value="published">Published</SelectItem></SelectContent></Select></Field>
              <Field label="Publish at"><Input type="datetime-local" value={post.publishedAt || ""} onChange={(event) => update("publishedAt", event.target.value)} /></Field>
              <Field label="Scheduled at"><Input type="datetime-local" value={post.scheduledAt || ""} onChange={(event) => update("scheduledAt", event.target.value)} /></Field>
              <Field label="Category"><Select value={post.categoryId || "none"} onValueChange={(value) => update("categoryId", value === "none" ? "" : value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">None</SelectItem>{categories.map((category) => <SelectItem key={category.id} value={category.id}>{category.name}</SelectItem>)}</SelectContent></Select></Field>
              <Field label="Featured image"><Select value={post.featuredImageId || "none"} onValueChange={(value) => update("featuredImageId", value === "none" ? "" : value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">None</SelectItem>{media.map((asset) => <SelectItem key={asset.id} value={asset.id}>{asset.optimizedName || asset.originalName}</SelectItem>)}</SelectContent></Select></Field>
              <div className="space-y-2">
                <Label>Tags</Label>
                <div className="flex flex-wrap gap-2">
                  {tags.map((tag) => {
                    const active = post.tagIds.includes(tag.id)
                    return <button key={tag.id} type="button" className={`rounded-full border px-3 py-1 text-xs ${active ? "border-teal-400/50 bg-teal-400/10 text-teal-100" : "border-border/40 text-muted-foreground"}`} onClick={() => update("tagIds", active ? post.tagIds.filter((id) => id !== tag.id) : [...post.tagIds, tag.id])}>{tag.name}</button>
                  })}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="glass border-border/40">
            <CardHeader><CardTitle>SEO</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <Field label="Meta title"><Input value={post.seoTitle || ""} onChange={(event) => update("seoTitle", event.target.value)} /></Field>
              <Field label="Meta description"><Textarea value={post.seoDescription || ""} onChange={(event) => update("seoDescription", event.target.value)} /></Field>
              <Field label="Canonical URL"><Input value={post.canonicalUrl || ""} onChange={(event) => update("canonicalUrl", event.target.value)} /></Field>
              <Field label="Robots"><Input value={post.robots || ""} onChange={(event) => update("robots", event.target.value)} /></Field>
              <Field label="OG image"><Select value={post.ogImageId || "none"} onValueChange={(value) => update("ogImageId", value === "none" ? "" : value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">None</SelectItem>{media.map((asset) => <SelectItem key={asset.id} value={asset.id}>{asset.optimizedName || asset.originalName}</SelectItem>)}</SelectContent></Select></Field>
              <Field label="Schema JSON"><Textarea className="min-h-32 font-mono text-xs" value={post.schemaJsonText} onChange={(event) => update("schemaJsonText", event.target.value)} /></Field>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-2"><Label>{label}</Label>{children}</div>
}
