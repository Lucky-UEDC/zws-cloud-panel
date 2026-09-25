"use client"

import { readJsonResponse } from "@/lib/client/safe-json"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"

type Category = {
  id: string
  parentId: string | null
  title: string
  slug: string
  isActive: boolean
  showInNav: boolean
  sortOrder: number
  parent?: { title: string; slug: string } | null
  children: Array<{ id: string; title: string; slug: string }>
}

export default function AdminCategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([])
  const [form, setForm] = useState({
    title: "",
    slug: "",
    parentId: "",
    sortOrder: "0",
  })

  async function load() {
    const res = await fetch("/api/admin/categories")
    const data = await readJsonResponse<any>(res)
    if (res.ok) setCategories(data.categories || [])
  }

  useEffect(() => {
    void load()
  }, [])

  async function createCategory() {
    const res = await fetch("/api/admin/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: form.title,
        slug: form.slug,
        parentId: form.parentId || null,
        sortOrder: Number(form.sortOrder || 0),
      }),
    })
    const data = await readJsonResponse<any>(res)
    if (!res.ok) {
      toast.error(data.error || "Failed to create category")
      return
    }
    toast.success("Category created")
    setForm({ title: "", slug: "", parentId: "", sortOrder: "0" })
    await load()
  }

  const rootCategories = categories.filter((category) => !category.parentId)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold">Categories</h1>
        <p className="mt-1 text-muted-foreground">Manage main categories, subcategories, and public navigation structure.</p>
      </div>

      <Card className="glass border-border/40">
        <CardHeader>
          <CardTitle>Create Category</CardTitle>
          <CardDescription>Add a root category or assign it under an existing category as a subcategory.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2"><Label>Title</Label><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
          <div className="space-y-2"><Label>Slug</Label><Input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} /></div>
          <div className="space-y-2">
            <Label>Parent Category</Label>
            <select value={form.parentId} onChange={(e) => setForm({ ...form, parentId: e.target.value })} className="h-9 w-full rounded-md border border-border/40 bg-background px-3 text-sm">
              <option value="">None (root category)</option>
              {rootCategories.map((category) => (
                <option key={category.id} value={category.id}>{category.title}</option>
              ))}
            </select>
          </div>
          <div className="space-y-2"><Label>Sort Order</Label><Input value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: e.target.value })} /></div>
          <div className="md:col-span-2"><Button onClick={createCategory}>Create Category</Button></div>
        </CardContent>
      </Card>

      <Card className="glass border-border/40">
        <CardHeader><CardTitle>Catalog Taxonomy</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {rootCategories.map((category) => (
            <div key={category.id} className="rounded-xl border border-border/40 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-medium">{category.title}</p>
                  <p className="text-sm text-muted-foreground">/{category.slug}</p>
                </div>
                <div className="text-xs text-muted-foreground">
                  {category.isActive ? "Active" : "Inactive"} · {category.showInNav ? "In nav" : "Hidden from nav"}
                </div>
              </div>
              {category.children.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {category.children.map((child) => (
                    <span key={child.id} className="rounded-full bg-muted/20 px-3 py-1 text-xs text-muted-foreground">
                      {child.title} · /{category.slug}/{child.slug}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-sm text-muted-foreground">No subcategories yet.</p>
              )}
            </div>
          ))}
          {!rootCategories.length ? <p className="text-sm text-muted-foreground">No categories configured yet.</p> : null}
        </CardContent>
      </Card>
    </div>
  )
}
