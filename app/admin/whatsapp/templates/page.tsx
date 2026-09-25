"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import type React from "react"
import Link from "next/link"
import { AlertTriangle, BarChart3, CheckCircle2, Copy, FileText, ImageIcon, Languages, Plus, RefreshCw, Save, Send, ShieldCheck, Smartphone, Sparkles, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { readJsonResponse } from "@/lib/client/safe-json"
import { useRuntimeBrand } from "@/lib/client/use-runtime-brand"
import { cn } from "@/lib/utils"
import { WhatsAppNav } from "@/components/admin/whatsapp-nav"

const categories = ["authentication", "utility", "marketing", "support", "onboarding", "billing", "security", "provisioning"]
const languages = ["en", "hi", "bn", "ar", "es"]
const statuses = ["draft", "pending_review", "approved", "rejected", "paused", "archived"]
const headerTypes = ["none", "text", "image", "video", "document"]
const buttonTypes = ["quick_reply", "url", "call", "copy_code"]

type TemplateButton = { id?: string; type: string; label: string; value?: string }
type Template = {
  id?: string
  key: string
  slug: string
  name: string
  category: string
  language: string
  status: string
  headerType: string
  headerText?: string | null
  body: string
  footer?: string | null
  buttons: TemplateButton[]
  mediaUrl?: string | null
  templateVariables?: string[]
  variables?: string[]
  isSystem?: boolean
  isActive?: boolean
  enabled?: boolean
  translations?: any[]
  versions?: any[]
}

type Variable = {
  id: string
  group: string
  key: string
  label: string
  sampleValue?: string | null
  sensitive?: boolean
}

type ValidationIssue = { level: "error" | "warning"; code: string; message: string }

const emptyDraft: Template = {
  key: "",
  slug: "",
  name: "",
  category: "billing",
  language: "en",
  status: "draft",
  headerType: "none",
  headerText: "",
  body: "Hi {{first_name}}, your invoice #{{invoice_id}} for ₹{{invoice_total}} is now ready. You can securely complete payment using the button below.",
  footer: "",
  buttons: [{ id: "button_1", type: "url", label: "Open Dashboard", value: "{{dashboard_url}}" }],
  mediaUrl: "",
  templateVariables: ["first_name", "invoice_id", "invoice_total", "dashboard_url"],
  isActive: true,
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9_ -]/g, "").replace(/[\s-]+/g, "_").replace(/^_+|_+$/g, "")
}

function extractVariables(...parts: Array<string | null | undefined>) {
  const matches = parts.filter(Boolean).join("\n").matchAll(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g)
  return Array.from(new Set(Array.from(matches).map((match) => match[1])))
}

function renderPreview(template: Template, variables: Variable[]) {
  const sample = Object.fromEntries(variables.map((variable) => [variable.key, variable.sampleValue || variable.label]))
  const replace = (value?: string | null) => String(value || "").replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_, key) => sample[key] || `{{${key}}}`)
  const header = template.headerType === "text" ? replace(template.headerText) : ""
  const body = replace(template.body)
  const footer = replace(template.footer)
  const buttons = (template.buttons || []).map((button) => ({ ...button, label: replace(button.label), value: replace(button.value) }))
  return { header, body, footer, buttons }
}

async function readApi<T>(response: Response): Promise<T> {
  const data = await readJsonResponse<any>(response)
  if (!response.ok) throw new Error(data?.error || data?.message || "Request failed")
  return data as T
}

export default function WhatsAppTemplatesPage() {
  const brand = useRuntimeBrand()
  const [templates, setTemplates] = useState<Template[]>([])
  const [variables, setVariables] = useState<Variable[]>([])
  const [analytics, setAnalytics] = useState<any>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Template>(emptyDraft)
  const [validation, setValidation] = useState<ValidationIssue[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testPhone, setTestPhone] = useState("")
  const [filters, setFilters] = useState({ category: "all", language: "all", status: "all", q: "" })

  const selected = useMemo(() => templates.find((template) => template.id === selectedId) || null, [selectedId, templates])
  const preview = useMemo(() => renderPreview(draft, variables), [draft, variables])
  const groupedVariables = useMemo(() => {
    return variables.reduce<Record<string, Variable[]>>((groups, variable) => {
      groups[variable.group] ||= []
      groups[variable.group].push(variable)
      return groups
    }, {})
  }, [variables])

  const choose = useCallback((template: Template) => {
    setSelectedId(template.id || null)
    setDraft({
      ...template,
      slug: template.slug || template.key,
      headerType: template.headerType || "none",
      headerText: template.headerText || "",
      footer: template.footer || "",
      mediaUrl: template.mediaUrl || "",
      buttons: Array.isArray(template.buttons) ? template.buttons : [],
      templateVariables: template.templateVariables || template.variables || [],
      isActive: template.isActive ?? template.enabled ?? true,
    })
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams(filters)
      const data = await readApi<any>(await fetch(`/api/admin/whatsapp/templates?${params.toString()}`, { cache: "no-store" }))
      setTemplates(data.templates || [])
      setVariables(data.variables || [])
      setAnalytics(data.analytics || null)
      if (!selectedId && data.templates?.[0]) {
        choose(data.templates[0])
      }
    } catch (error: any) {
      toast.error(error.message || "Unable to load WhatsApp templates")
    } finally {
      setLoading(false)
    }
  }, [choose, filters, selectedId])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    setValidation(validateLocal(draft, variables))
  }, [draft, variables])

  function startNew() {
    setSelectedId(null)
    setDraft({ ...emptyDraft, key: "", slug: "", name: "" })
  }

  function update<K extends keyof Template>(key: K, value: Template[K]) {
    setDraft((current) => {
      const next = { ...current, [key]: value }
      if (key === "name" && !selectedId) {
        next.slug = slugify(String(value))
        next.key = next.slug
      }
      const extracted = extractVariables(next.headerText, next.body, next.footer, ...(next.buttons || []).flatMap((button) => [button.label, button.value]))
      next.templateVariables = extracted
      return next
    })
  }

  function addVariable(key: string) {
    const insertion = `{{${key}}}`
    update("body", `${draft.body}${draft.body.endsWith(" ") || draft.body.endsWith("\n") ? "" : " "}${insertion}`)
  }

  function updateButton(index: number, patch: Partial<TemplateButton>) {
    const buttons = [...(draft.buttons || [])]
    buttons[index] = { ...buttons[index], ...patch }
    update("buttons", buttons)
  }

  function addButton() {
    update("buttons", [...(draft.buttons || []), { id: `button_${Date.now()}`, type: "quick_reply", label: "Contact Support", value: "" }])
  }

  function removeButton(index: number) {
    update("buttons", (draft.buttons || []).filter((_, current) => current !== index))
  }

  async function save() {
    setSaving(true)
    try {
      const url = selectedId ? `/api/admin/whatsapp/templates/${selectedId}` : "/api/admin/whatsapp/templates"
      const method = selectedId ? "PATCH" : "POST"
      const data = await readApi<any>(await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      }))
      toast.success(selectedId ? "Template updated" : "Template created")
      if (data.validation) setValidation(data.validation)
      await load()
      if (data.template) choose(data.template)
    } catch (error: any) {
      toast.error(error.message || "Unable to save template")
    } finally {
      setSaving(false)
    }
  }

  async function resetPresets() {
    setSaving(true)
    try {
      const data = await readApi<any>(await fetch("/api/admin/whatsapp/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reset_presets" }),
      }))
      setTemplates(data.templates || [])
      toast.success("Premium WhatsApp presets seeded")
    } catch (error: any) {
      toast.error(error.message || "Unable to seed presets")
    } finally {
      setSaving(false)
    }
  }

  async function sendTest() {
    if (!selectedId) {
      toast.error("Save the template before sending a test")
      return
    }
    try {
      const data = await readApi<any>(await fetch(`/api/admin/whatsapp/templates/${selectedId}/test-send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: testPhone }),
      }))
      toast.success(`Queued test to ${data.sent?.toMasked || "recipient"}`)
    } catch (error: any) {
      toast.error(error.message || "Unable to send test")
    }
  }

  async function uploadMedia(file: File | null) {
    if (!file) return
    const formData = new FormData()
    formData.set("file", file)
    try {
      const data = await readApi<any>(await fetch("/api/admin/whatsapp/media", { method: "POST", body: formData }))
      update("mediaUrl", data.url)
      if (data.mediaType && headerTypes.includes(data.mediaType)) update("headerType", data.mediaType)
      toast.success("Media uploaded")
    } catch (error: any) {
      toast.error(error.message || "Unable to upload media")
    }
  }

  async function archiveTemplate() {
    if (!selectedId) return
    try {
      await readApi<any>(await fetch(`/api/admin/whatsapp/templates/${selectedId}`, { method: "DELETE" }))
      toast.success("Template archived")
      setSelectedId(null)
      setDraft(emptyDraft)
      await load()
    } catch (error: any) {
      toast.error(error.message || "Unable to archive template")
    }
  }

  const errors = validation.filter((issue) => issue.level === "error")
  const warnings = validation.filter((issue) => issue.level === "warning")
  const statsCards = [
    { label: "Sent", value: analytics?.sent || 0, Icon: Send },
    { label: "Delivered", value: analytics?.delivered || 0, Icon: CheckCircle2 },
    { label: "Read", value: analytics?.read || 0, Icon: Smartphone },
    { label: "Failed", value: analytics?.failed || 0, Icon: AlertTriangle },
  ]

  return (
    <div className="min-w-0 max-w-full space-y-6 overflow-x-hidden">
      <WhatsAppNav />
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">WhatsApp Template Studio</h1>
          <p className="text-sm text-muted-foreground">Premium mobile-first templates with variables, translations, media, CTAs, validation, and analytics.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline"><Link href="/admin/whatsapp">WhatsApp</Link></Button>
          <Button variant="outline" onClick={resetPresets} disabled={saving}><Sparkles className="mr-2 h-4 w-4" /> Presets</Button>
          <Button onClick={startNew}><Plus className="mr-2 h-4 w-4" /> New</Button>
        </div>
      </div>

      <div className="grid min-w-0 gap-4 md:grid-cols-4">
        {statsCards.map(({ label, value, Icon }) => (
          <Card key={label} className="border-slate-800 bg-slate-950 text-slate-100">
            <CardContent className="flex items-center justify-between p-4">
              <div>
                <p className="text-xs text-slate-400">{label}</p>
                <p className="text-2xl font-semibold">{value}</p>
              </div>
              <Icon className="h-5 w-5 text-emerald-300" />
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(280px,380px)_minmax(0,1fr)_minmax(280px,360px)]">
        <Card className="border-slate-800 bg-slate-950 text-slate-100">
          <CardHeader className="space-y-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Templates</CardTitle>
              <Button size="icon" variant="ghost" onClick={load} disabled={loading}><RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} /></Button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Select value={filters.category} onValueChange={(value) => setFilters((current) => ({ ...current, category: value }))}>
                <SelectTrigger className="bg-slate-900"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="all">All</SelectItem>{categories.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={filters.language} onValueChange={(value) => setFilters((current) => ({ ...current, language: value }))}>
                <SelectTrigger className="bg-slate-900"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="all">All</SelectItem>{languages.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={filters.status} onValueChange={(value) => setFilters((current) => ({ ...current, status: value }))}>
                <SelectTrigger className="bg-slate-900"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="all">All</SelectItem>{statuses.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <Input className="bg-slate-900" placeholder="Search templates" value={filters.q} onChange={(event) => setFilters((current) => ({ ...current, q: event.target.value }))} onKeyDown={(event) => { if (event.key === "Enter") void load() }} />
          </CardHeader>
          <CardContent className="hide-scrollbar max-h-[720px] space-y-2 overflow-auto">
            {templates.map((template) => (
              <button
                key={template.id}
                className={cn("w-full rounded-lg border p-3 text-left transition", selectedId === template.id ? "border-emerald-400 bg-emerald-400/10" : "border-slate-800 bg-slate-900/70 hover:border-slate-600")}
                onClick={() => choose(template)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-slate-100">{template.name}</p>
                    <p className="text-xs text-slate-400">{template.slug || template.key}</p>
                  </div>
                  {template.isSystem ? <ShieldCheck className="h-4 w-4 text-emerald-300" /> : null}
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  <Badge variant="outline" className="border-slate-700 text-slate-300">{template.category}</Badge>
                  <Badge variant="outline" className="border-slate-700 text-slate-300">{template.language}</Badge>
                  <Badge className={cn(template.status === "approved" ? "bg-emerald-500/20 text-emerald-200" : "bg-amber-500/20 text-amber-200")}>{template.status}</Badge>
                </div>
              </button>
            ))}
          </CardContent>
        </Card>

        <Card className="border-slate-800 bg-slate-950 text-slate-100">
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle className="text-base">Builder</CardTitle>
              <div className="flex gap-2">
                <Button variant="outline" onClick={archiveTemplate} disabled={!selectedId}><Trash2 className="mr-2 h-4 w-4" /> Archive</Button>
                <Button onClick={save} disabled={saving || !draft.name || !draft.body || errors.length > 0}><Save className="mr-2 h-4 w-4" /> Save</Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="content">
              <TabsList className="hide-scrollbar grid w-full grid-cols-4 overflow-x-auto bg-slate-900">
                <TabsTrigger value="content">Content</TabsTrigger>
                <TabsTrigger value="buttons">Buttons</TabsTrigger>
                <TabsTrigger value="variables">Variables</TabsTrigger>
                <TabsTrigger value="versions">Versions</TabsTrigger>
              </TabsList>

              <TabsContent value="content" className="mt-4 space-y-4">
                <div className="grid min-w-0 gap-4 md:grid-cols-2">
                  <Field label="Name"><Input className="bg-slate-900" value={draft.name} onChange={(event) => update("name", event.target.value)} placeholder="Invoice ready" /></Field>
                  <Field label="Slug"><Input className="bg-slate-900" value={draft.slug} onChange={(event) => { update("slug", slugify(event.target.value)); update("key", slugify(event.target.value)) }} placeholder="invoice_ready" /></Field>
                  <Field label="Category"><DarkSelect value={draft.category} items={categories} onChange={(value) => update("category", value)} /></Field>
                  <Field label="Language"><DarkSelect value={draft.language} items={languages} onChange={(value) => update("language", value)} /></Field>
                  <Field label="Status"><DarkSelect value={draft.status} items={statuses} onChange={(value) => update("status", value)} /></Field>
                  <Field label="Header"><DarkSelect value={draft.headerType} items={headerTypes} onChange={(value) => update("headerType", value)} /></Field>
                </div>
                {draft.headerType === "text" ? (
                  <Field label="Header text"><Input className="bg-slate-900" value={draft.headerText || ""} onChange={(event) => update("headerText", event.target.value)} maxLength={60} /></Field>
                ) : null}
                {draft.headerType !== "none" && draft.headerType !== "text" ? (
                  <div className="grid min-w-0 gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
                    <Field label="Media URL"><Input className="bg-slate-900" value={draft.mediaUrl || ""} onChange={(event) => update("mediaUrl", event.target.value)} placeholder="/uploads/whatsapp/banner.png" /></Field>
                    <Field label="Upload media"><Input className="bg-slate-900" type="file" accept="image/*,video/mp4,application/pdf" onChange={(event) => void uploadMedia(event.target.files?.[0] || null)} /></Field>
                  </div>
                ) : null}
                <Field label="Body">
                  <Textarea className="min-h-[300px] bg-slate-900 font-mono text-sm" value={draft.body} onChange={(event) => update("body", event.target.value)} />
                </Field>
                <Field label="Footer"><Input className="bg-slate-900" value={draft.footer || ""} onChange={(event) => update("footer", event.target.value)} maxLength={60} /></Field>
              </TabsContent>

              <TabsContent value="buttons" className="mt-4 space-y-4">
                {(draft.buttons || []).map((button, index) => (
                  <div key={button.id || index} className="grid min-w-0 gap-3 rounded-lg border border-slate-800 bg-slate-900/60 p-3 md:grid-cols-[150px_minmax(0,1fr)_minmax(0,1fr)_auto]">
                    <DarkSelect value={button.type} items={buttonTypes} onChange={(value) => updateButton(index, { type: value })} />
                    <Input className="bg-slate-950" value={button.label} onChange={(event) => updateButton(index, { label: event.target.value })} placeholder="Pay Invoice" />
                    <Input className="bg-slate-950" value={button.value || ""} onChange={(event) => updateButton(index, { value: event.target.value })} placeholder="{{payment_link}}" />
                    <Button size="icon" variant="ghost" onClick={() => removeButton(index)}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                ))}
                <Button variant="outline" onClick={addButton}><Plus className="mr-2 h-4 w-4" /> Add Button</Button>
              </TabsContent>

              <TabsContent value="variables" className="mt-4 space-y-4">
                {Object.entries(groupedVariables).map(([group, items]) => (
                  <div key={group}>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{group}</p>
                    <div className="flex flex-wrap gap-2">
                      {items.map((variable) => (
                        <Button key={variable.key} size="sm" variant="outline" className="border-slate-700" onClick={() => addVariable(variable.key)}>
                          <Copy className="mr-2 h-3 w-3" />{"{{"}{variable.key}{"}}"}
                        </Button>
                      ))}
                    </div>
                  </div>
                ))}
              </TabsContent>

              <TabsContent value="versions" className="mt-4 space-y-3">
                {(selected?.translations || []).length ? (
                  <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
                    <p className="mb-2 flex items-center text-sm font-medium"><Languages className="mr-2 h-4 w-4" /> Translations</p>
                    <div className="flex flex-wrap gap-2">{selected?.translations?.map((translation) => <Badge key={translation.id} variant="outline">{translation.language} · {translation.status}</Badge>)}</div>
                  </div>
                ) : null}
                {(selected?.versions || []).map((version) => (
                  <div key={version.id} className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-medium">Version {version.version}</p>
                        <p className="text-xs text-slate-400">{new Date(version.createdAt).toLocaleString()}</p>
                      </div>
                      <Badge variant="outline">{version.status}</Badge>
                    </div>
                    <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-xs text-slate-300">{version.body}</p>
                  </div>
                ))}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        <div className="min-w-0 space-y-4">
          <Card className="border-slate-800 bg-slate-950 text-slate-100">
            <CardHeader><CardTitle className="flex items-center text-base"><Smartphone className="mr-2 h-4 w-4" /> Live Preview</CardTitle></CardHeader>
            <CardContent>
              <div className="mx-auto max-w-[310px] rounded-[2rem] border border-slate-700 bg-slate-900 p-3 shadow-2xl">
                <div className="rounded-[1.5rem] bg-[#0b141a] p-3 text-[13px] text-slate-100">
                  <div className="mb-3 flex items-center gap-2 border-b border-white/10 pb-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500 text-xs font-bold">Z</div>
                    <div><p className="font-semibold">{brand.brandName}</p><p className="text-[11px] text-slate-400">Business Account</p></div>
                  </div>
                  {draft.headerType === "image" ? <div className="mb-2 flex h-28 items-center justify-center rounded-lg bg-slate-800 text-slate-400"><ImageIcon className="h-6 w-6" /></div> : null}
                  {draft.headerType === "document" ? <div className="mb-2 flex h-16 items-center gap-2 rounded-lg bg-slate-800 px-3 text-slate-300"><FileText className="h-5 w-5" /> Invoice PDF</div> : null}
                  <div className="rounded-lg bg-[#202c33] p-3 leading-relaxed">
                    {preview.header ? <p className="mb-2 font-semibold">{preview.header}</p> : null}
                    <pre className="whitespace-pre-wrap break-words font-sans">{preview.body}</pre>
                    {preview.footer ? <p className="mt-3 text-[11px] text-slate-400">{preview.footer}</p> : null}
                  </div>
                  {preview.buttons.length ? <div className="mt-2 space-y-1">{preview.buttons.map((button, index) => <div key={index} className="rounded-lg bg-[#202c33] py-2 text-center text-emerald-300">{button.label}</div>)}</div> : null}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-800 bg-slate-950 text-slate-100">
            <CardHeader><CardTitle className="flex items-center text-base"><BarChart3 className="mr-2 h-4 w-4" /> Validation</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {!validation.length ? <p className="flex items-center text-sm text-emerald-300"><CheckCircle2 className="mr-2 h-4 w-4" /> Looks ready for clean delivery.</p> : null}
              {errors.map((issue) => <Issue key={issue.code} issue={issue} />)}
              {warnings.map((issue) => <Issue key={issue.code} issue={issue} />)}
              <div className="grid grid-cols-2 gap-2 pt-2">
                <Input className="bg-slate-900" placeholder="+919876543210" value={testPhone} onChange={(event) => setTestPhone(event.target.value)} />
                <Button onClick={sendTest} disabled={!selectedId || !testPhone}><Send className="mr-2 h-4 w-4" /> Test</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-2"><Label className="text-slate-300">{label}</Label>{children}</div>
}

function DarkSelect({ value, items, onChange }: { value: string; items: string[]; onChange: (value: string) => void }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="bg-slate-900"><SelectValue /></SelectTrigger>
      <SelectContent>{items.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent>
    </Select>
  )
}

function Issue({ issue }: { issue: ValidationIssue }) {
  return (
    <div className={cn("rounded-lg border p-3 text-sm", issue.level === "error" ? "border-red-500/30 bg-red-500/10 text-red-100" : "border-amber-500/30 bg-amber-500/10 text-amber-100")}>
      <p className="font-medium">{issue.level === "error" ? "Fix required" : "Approval risk"}</p>
      <p className="mt-1 text-xs opacity-90">{issue.message}</p>
    </div>
  )
}

function validateLocal(template: Template, variables: Variable[]): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const text = [template.headerText, template.body, template.footer, ...(template.buttons || []).flatMap((button) => [button.label, button.value])].filter(Boolean).join("\n")
  const known = new Set(variables.map((variable) => variable.key))
  const used = extractVariables(text)
  const unknown = used.filter((key) => !known.has(key))
  if (!template.body.trim()) issues.push({ level: "error", code: "body_required", message: "Template body is required." })
  if (template.body.length > 1024) issues.push({ level: "error", code: "body_too_long", message: "Body should stay within 1,024 characters." })
  if ((template.footer || "").includes("{{")) issues.push({ level: "error", code: "footer_variables", message: "Footer cannot contain variables." })
  if (/\}\}\s*\{\{/.test(text)) issues.push({ level: "error", code: "adjacent_placeholders", message: "Add words between adjacent placeholders." })
  if (unknown.length) issues.push({ level: "warning", code: "unknown_variables", message: `Unknown variables: ${unknown.join(", ")}.` })
  if (template.category === "authentication" && !used.includes("otp_code")) issues.push({ level: "error", code: "otp_required", message: "Authentication templates must include {{otp_code}}." })
  if (template.category === "marketing" && !/stop|unsubscribe|opt out/i.test(text)) issues.push({ level: "warning", code: "marketing_opt_out", message: "Marketing copy should include opt-out wording." })
  return issues
}
