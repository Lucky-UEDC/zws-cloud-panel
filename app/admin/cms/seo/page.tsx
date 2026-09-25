"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { readJsonResponse } from "@/lib/client/safe-json"

export default function CmsSeoPage() {
  const [pages, setPages] = useState<any[]>([])
  const [form, setForm] = useState({ path: "/", title: "", description: "", ogImage: "", canonicalUrl: "", robots: "index, follow", schemaJsonText: "{}" })

  async function load() {
    const res = await fetch("/api/admin/cms/seo", { cache: "no-store" })
    const data = await readJsonResponse<any>(res).catch(() => ({}))
    if (res.ok) setPages(data.pages || [])
  }
  useEffect(() => {
    void load()
  }, [])

  async function save() {
    let schemaJson = {}
    try { schemaJson = JSON.parse(form.schemaJsonText || "{}") } catch { return toast.error("Schema JSON is invalid") }
    const res = await fetch("/api/admin/cms/seo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, schemaJson }) })
    const data = await readJsonResponse<any>(res).catch(() => ({}))
    if (!res.ok) return toast.error(data.error || "Save failed")
    toast.success("SEO page saved")
    await load()
  }

  return (
    <div className="space-y-6">
      <div><h1 className="text-3xl font-semibold">SEO Pages</h1><p className="mt-1 text-sm text-muted-foreground">Manage metadata, canonical URLs, robots, OG images, and schema markup.</p></div>
      <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
        <Card className="glass border-border/40"><CardHeader><CardTitle>Metadata</CardTitle></CardHeader><CardContent className="space-y-3">
          {(["path", "title", "ogImage", "canonicalUrl", "robots"] as const).map((key) => <Field key={key} label={key}><Input value={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.value })} /></Field>)}
          <Field label="description"><Textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></Field>
          <Field label="schema JSON"><Textarea className="min-h-32 font-mono text-xs" value={form.schemaJsonText} onChange={(event) => setForm({ ...form, schemaJsonText: event.target.value })} /></Field>
          <Button onClick={save} className="w-full">Save</Button>
        </CardContent></Card>
        <Card className="glass border-border/40"><CardHeader><CardTitle>Pages</CardTitle></CardHeader><CardContent className="space-y-3">
          {pages.map((page) => <button key={page.id} type="button" className="w-full rounded-lg border border-border/40 bg-background/35 p-3 text-left" onClick={() => setForm({ path: page.path, title: page.title || "", description: page.description || "", ogImage: page.ogImage || "", canonicalUrl: page.canonicalUrl || "", robots: page.robots || "index, follow", schemaJsonText: JSON.stringify(page.schemaJson || {}, null, 2) })}><div className="font-medium">{page.path}</div><div className="text-sm text-muted-foreground">{page.title || "Untitled"}</div></button>)}
        </CardContent></Card>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-2"><Label>{label}</Label>{children}</div>
}
