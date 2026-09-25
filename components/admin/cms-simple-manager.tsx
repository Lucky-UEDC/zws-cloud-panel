"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { readJsonResponse } from "@/lib/client/safe-json"

export function CmsSimpleManager({ title, description, endpoint, itemKey }: { title: string; description: string; endpoint: string; itemKey: string }) {
  const [items, setItems] = useState<any[]>([])
  const [form, setForm] = useState({ name: "", slug: "", description: "", seoTitle: "", seoDescription: "" })

  async function load() {
    const res = await fetch(endpoint, { cache: "no-store" })
    const data = await readJsonResponse<any>(res).catch(() => ({}))
    if (res.ok) setItems(data[itemKey] || [])
  }
  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function save() {
    const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) })
    const data = await readJsonResponse<any>(res).catch(() => ({}))
    if (!res.ok) return toast.error(data.error || "Save failed")
    setForm({ name: "", slug: "", description: "", seoTitle: "", seoDescription: "" })
    toast.success("Saved")
    await load()
  }

  return (
    <div className="space-y-6">
      <div><h1 className="text-3xl font-semibold">{title}</h1><p className="mt-1 text-sm text-muted-foreground">{description}</p></div>
      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        <Card className="glass border-border/40"><CardHeader><CardTitle>Create</CardTitle></CardHeader><CardContent className="space-y-3">
          <Field label="Name"><Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field>
          <Field label="SEO slug"><Input value={form.slug} onChange={(event) => setForm({ ...form, slug: event.target.value })} /></Field>
          <Field label="Description"><Textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></Field>
          <Field label="Meta title"><Input value={form.seoTitle} onChange={(event) => setForm({ ...form, seoTitle: event.target.value })} /></Field>
          <Field label="Meta description"><Textarea value={form.seoDescription} onChange={(event) => setForm({ ...form, seoDescription: event.target.value })} /></Field>
          <Button onClick={save} className="w-full">Save</Button>
        </CardContent></Card>
        <Card className="glass border-border/40"><CardHeader><CardTitle>Existing</CardTitle><CardDescription>{items.length} records</CardDescription></CardHeader><CardContent className="grid gap-3 md:grid-cols-2">
          {items.map((item) => <div key={item.id} className="rounded-lg border border-border/40 bg-background/35 p-3"><div className="font-medium">{item.name}</div><div className="text-sm text-muted-foreground">/{item.slug}</div>{item._count?.posts ? <div className="mt-1 text-xs text-muted-foreground">{item._count.posts} related posts</div> : null}</div>)}
        </CardContent></Card>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-2"><Label>{label}</Label>{children}</div>
}
