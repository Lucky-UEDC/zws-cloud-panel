"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { Eye, RotateCcw, Save, Send } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { readJsonResponse } from "@/lib/client/safe-json"

type EmailConfig = {
  smtpHost: string
  smtpPort: number
  smtpSecure: boolean
  smtpUser: string
  smtpPass: string
  fromName: string
  fromEmail: string
  replyTo: string
  enabled: boolean
}

type EmailTemplate = {
  id: string
  key: string
  group: string
  category: string
  name: string
  subject: string
  preheader?: string | null
  htmlBody: string
  textBody: string
  enabled: boolean
  updatedAt: string
}

type EmailLog = {
  id: string
  templateKey?: string | null
  recipient: string
  subject: string
  status: string
  error?: string | null
  createdAt: string
}

const defaultConfig: EmailConfig = {
  smtpHost: "",
  smtpPort: 587,
  smtpSecure: false,
  smtpUser: "",
  smtpPass: "",
  fromName: "Cloud",
  fromEmail: "",
  replyTo: "",
  enabled: false,
}

const tabs = [
  { key: "smtp", label: "SMTP Settings", href: "/admin/email/smtp" },
  { key: "templates", label: "Email Templates", href: "/admin/email/templates" },
  { key: "logs", label: "Email Logs", href: "/admin/email/logs" },
]

function apiError(body: any, fallback: string) {
  if (body?.code === "ADMIN_UNAUTHORIZED") return "Your admin session expired. Please log in again."
  if (body?.code === "SMTP_AUTH_FAILED") return "SMTP authentication failed. Check mailbox username and password."
  if (body?.code === "SMTP_TLS_FAILED") return "SMTP TLS failed. Try SSL/TLS 465 or STARTTLS 587."
  if (body?.code === "SMTP_CONNECTION_TIMEOUT") return "Could not connect to SMTP server."
  return body?.error || body?.message || fallback
}

export function EmailConsole({ initialTab }: { initialTab: "smtp" | "templates" | "logs" }) {
  const [config, setConfig] = useState<EmailConfig>(defaultConfig)
  const [templates, setTemplates] = useState<EmailTemplate[]>([])
  const [variables, setVariables] = useState<string[]>([])
  const [logs, setLogs] = useState<EmailLog[]>([])
  const [selectedKey, setSelectedKey] = useState("")
  const [preview, setPreview] = useState<any>(null)
  const [testRecipient, setTestRecipient] = useState("")
  const [saving, setSaving] = useState(false)

  const selected = templates.find((template) => template.key === selectedKey) || templates[0] || null
  const grouped = useMemo(() => {
    const map = new Map<string, EmailTemplate[]>()
    for (const template of templates) {
      const group = template.category || template.group
      map.set(group, [...(map.get(group) || []), template])
    }
    return Array.from(map.entries()).map(([group, items]) => ({ group, templates: items }))
  }, [templates])

  const load = useCallback(async () => {
    const requests: Promise<void>[] = []
    if (initialTab === "smtp") {
      requests.push(fetch("/api/admin/email/smtp", { credentials: "include" }).then(async (res) => {
        const data = await readJsonResponse<any>(res)
        if (!res.ok) throw new Error(apiError(data, "Failed to load SMTP settings"))
        setConfig({ ...defaultConfig, ...(data.config || {}) })
      }))
    }
    if (initialTab === "templates") {
      requests.push(fetch("/api/admin/email/templates", { credentials: "include" }).then(async (res) => {
        const data = await readJsonResponse<any>(res)
        if (!res.ok) throw new Error(apiError(data, "Failed to load email templates"))
        const nextTemplates = Array.isArray(data.templates) ? data.templates : []
        setTemplates(nextTemplates)
        setVariables(Array.isArray(data.variables) ? data.variables : [])
        setSelectedKey((current) => current || nextTemplates[0]?.key || "")
      }))
      requests.push(fetch("/api/admin/email/smtp", { credentials: "include" }).then(async (res) => {
        const data = await readJsonResponse<any>(res)
        if (res.ok) setConfig({ ...defaultConfig, ...(data.config || {}) })
      }))
    }
    if (initialTab === "logs") {
      requests.push(fetch("/api/admin/email/logs", { credentials: "include" }).then(async (res) => {
        const data = await readJsonResponse<any>(res)
        if (!res.ok) throw new Error(apiError(data, "Failed to load email logs"))
        setLogs(Array.isArray(data.logs) ? data.logs : [])
      }))
    }
    await Promise.all(requests)
  }, [initialTab])

  useEffect(() => {
    load().catch((error) => toast.error(error instanceof Error ? error.message : "Failed to load email module"))
  }, [load])

  function patchConfig(patch: Partial<EmailConfig>) {
    setConfig((current) => ({ ...current, ...patch }))
  }

  function patchTemplate(patch: Partial<EmailTemplate>) {
    if (!selected) return
    setTemplates((current) => current.map((template) => template.key === selected.key ? { ...template, ...patch } : template))
  }

  async function saveSmtp() {
    setSaving(true)
    try {
      const res = await fetch("/api/admin/email/smtp", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      })
      const data = await readJsonResponse<any>(res)
      if (!res.ok) throw new Error(apiError(data, "Failed to save SMTP settings"))
      setConfig({ ...defaultConfig, ...(data.config || {}) })
      toast.success("SMTP settings saved")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save SMTP settings")
    } finally {
      setSaving(false)
    }
  }

  async function sendSmtpTest() {
    if (!testRecipient) return toast.error("Enter a test recipient")
    const res = await fetch("/api/admin/email/smtp/test", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: testRecipient, config }),
    })
    const data = await readJsonResponse<any>(res)
    if (!res.ok) return toast.error(apiError(data, "SMTP test failed"))
    toast.success(data.message || "SMTP test sent")
  }

  async function saveTemplate() {
    if (!selected) return
    setSaving(true)
    try {
      const res = await fetch(`/api/admin/email/templates/${selected.key}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(selected),
      })
      const data = await readJsonResponse<any>(res)
      if (!res.ok) throw new Error(apiError(data, "Failed to save template"))
      setTemplates((current) => current.map((template) => template.key === selected.key ? data.template : template))
      toast.success("Template saved")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save template")
    } finally {
      setSaving(false)
    }
  }

  async function previewTemplate() {
    if (!selected) return
    const res = await fetch(`/api/admin/email/templates/${selected.key}/preview`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })
    const data = await readJsonResponse<any>(res)
    if (!res.ok) return toast.error(apiError(data, "Failed to preview template"))
    setPreview(data.preview)
  }

  async function sendTemplateTest() {
    if (!selected || !testRecipient) return toast.error("Enter a test recipient")
    const res = await fetch(`/api/admin/email/templates/${selected.key}/test`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: testRecipient }),
    })
    const data = await readJsonResponse<any>(res)
    if (!res.ok) return toast.error(apiError(data, "Template test failed"))
    toast.success(data.message || "Template test sent")
  }

  async function resetTemplate() {
    if (!selected) return
    const res = await fetch(`/api/admin/email/templates/${selected.key}/reset`, { method: "POST", credentials: "include" })
    const data = await readJsonResponse<any>(res)
    if (!res.ok) return toast.error(apiError(data, "Failed to reset template"))
    setTemplates((current) => current.map((template) => template.key === selected.key ? data.template : template))
    setPreview(null)
    toast.success("Template reset")
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-semibold">Email</h1>
          <p className="mt-1 text-muted-foreground">Manage SMTP delivery, event templates, and delivery logs.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {tabs.map((tab) => (
            <Button key={tab.key} asChild variant={initialTab === tab.key ? "default" : "outline"} size="sm">
              <Link href={tab.href}>{tab.label}</Link>
            </Button>
          ))}
        </div>
      </div>

      {initialTab === "smtp" ? (
        <Card className="glass border-border/40">
          <CardHeader>
            <CardTitle>SMTP Settings</CardTitle>
            <CardDescription>Credentials are stored separately from platform Settings. The SMTP password is encrypted before storage.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div className="flex items-center justify-between rounded-lg border border-border/40 bg-background/30 px-3 py-2">
              <Label>SMTP enabled</Label>
              <Switch checked={Boolean(config.enabled)} onCheckedChange={(enabled) => patchConfig({ enabled })} />
            </div>
            <Field label="Host" value={config.smtpHost} onChange={(smtpHost) => patchConfig({ smtpHost })} />
            <Field label="Port" type="number" value={String(config.smtpPort || 587)} onChange={(smtpPort) => patchConfig({ smtpPort: Number(smtpPort || 0) })} />
            <div className="space-y-2">
              <Label>Secure connection</Label>
              <Select value={config.smtpSecure ? "true" : "false"} onValueChange={(value) => patchConfig({ smtpSecure: value === "true", smtpPort: value === "true" ? 465 : 587 })}>
                <SelectTrigger className="h-9 w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="true">true - SSL/TLS 465</SelectItem>
                  <SelectItem value="false">false - STARTTLS 587</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Field label="Username" value={config.smtpUser} onChange={(smtpUser) => patchConfig({ smtpUser })} />
            <Field label="Password" type="password" value={config.smtpPass} onChange={(smtpPass) => patchConfig({ smtpPass })} />
            <Field label="From name" value={config.fromName} onChange={(fromName) => patchConfig({ fromName })} />
            <Field label="From email" value={config.fromEmail} onChange={(fromEmail) => patchConfig({ fromEmail })} />
            <Field label="Reply-to email" value={config.replyTo || ""} onChange={(replyTo) => patchConfig({ replyTo })} />
            <Field label="Test recipient" value={testRecipient} onChange={setTestRecipient} />
          </CardContent>
          <CardContent className="flex flex-wrap gap-3">
            <Button className="gap-1.5" disabled={saving} onClick={saveSmtp}><Save className="h-4 w-4" />Save SMTP</Button>
            <Button className="gap-1.5" variant="outline" onClick={sendSmtpTest}><Send className="h-4 w-4" />Send test email</Button>
          </CardContent>
        </Card>
      ) : null}

      {initialTab === "templates" ? (
        <div className="grid gap-4 xl:grid-cols-[320px_1fr]">
          <Card className="glass border-border/40">
            <CardHeader>
              <CardTitle>Templates</CardTitle>
              <CardDescription>{templates.length} event templates grouped by category.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {grouped.map((group) => (
                <div key={group.group} className="space-y-2">
                  <p className="text-xs font-medium uppercase text-muted-foreground">{group.group}</p>
                  <div className="space-y-1">
                    {group.templates.map((template) => (
                      <button key={template.key} type="button" onClick={() => { setSelectedKey(template.key); setPreview(null) }} className={`w-full rounded-md border px-3 py-2 text-left text-sm transition-colors ${selected?.key === template.key ? "selected-item" : "border-[var(--border-primary)] hover:bg-[rgba(255,255,255,0.04)]"}`}>
                        <span className="block font-medium">{template.name}</span>
                        <span className="block text-xs text-muted-foreground">{template.key}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {selected ? (
            <Card className="glass border-border/40">
              <CardHeader>
                <CardTitle>{selected.name}</CardTitle>
                <CardDescription>{selected.key} · Updated {new Date(selected.updatedAt).toLocaleString()}</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4">
                <div className="flex items-center justify-between rounded-lg border border-border/40 bg-background/30 px-3 py-2">
                  <Label>Enabled</Label>
                  <Switch checked={Boolean(selected.enabled)} onCheckedChange={(enabled) => patchTemplate({ enabled })} />
                </div>
                <Field label="Name" value={selected.name} onChange={(name) => patchTemplate({ name })} />
                <Field label="Subject" value={selected.subject} onChange={(subject) => patchTemplate({ subject })} />
                <Field label="Preheader" value={selected.preheader || ""} onChange={(preheader) => patchTemplate({ preheader })} />
                <Editor label="HTML body" value={selected.htmlBody} onChange={(htmlBody) => patchTemplate({ htmlBody })} />
                <Editor label="Text body" value={selected.textBody} onChange={(textBody) => patchTemplate({ textBody })} />
                <div className="rounded-lg border border-border/40 bg-background/30 p-3">
                  <p className="text-sm font-medium">Supported variables</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {variables.map((variable) => <code key={variable} className="rounded bg-muted px-2 py-1 text-xs">{`{{${variable}}}`}</code>)}
                  </div>
                </div>
                <Field label="Test recipient" value={testRecipient} onChange={setTestRecipient} />
                {preview ? (
                  <div className="grid gap-3 rounded-lg border border-border/40 bg-background/30 p-3">
                    <div>
                      <p className="text-xs text-muted-foreground">Subject</p>
                      <p className="font-medium">{preview.subject}</p>
                    </div>
                    <div className="max-h-[560px] overflow-auto rounded-md border border-border/40 bg-background p-3" dangerouslySetInnerHTML={{ __html: preview.html }} />
                    <pre className="max-h-48 overflow-auto rounded-md bg-muted/40 p-3 text-xs whitespace-pre-wrap">{preview.text}</pre>
                  </div>
                ) : null}
              </CardContent>
              <CardContent className="flex flex-wrap gap-3">
                <Button className="gap-1.5" disabled={saving} onClick={saveTemplate}><Save className="h-4 w-4" />Save template</Button>
                <Button className="gap-1.5" variant="outline" onClick={previewTemplate}><Eye className="h-4 w-4" />Preview</Button>
                <Button className="gap-1.5" variant="outline" onClick={sendTemplateTest}><Send className="h-4 w-4" />Send test</Button>
                <Button className="gap-1.5" variant="outline" onClick={resetTemplate}><RotateCcw className="h-4 w-4" />Reset to default</Button>
              </CardContent>
            </Card>
          ) : null}
        </div>
      ) : null}

      {initialTab === "logs" ? (
        <Card className="glass border-border/40">
          <CardHeader>
            <CardTitle>Email Logs</CardTitle>
            <CardDescription>Recent SMTP delivery results. Sensitive SMTP credentials are never logged here.</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="border-b text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="py-2 pr-3">Time</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Template</th>
                  <th className="py-2 pr-3">Recipient</th>
                  <th className="py-2 pr-3">Subject</th>
                  <th className="py-2 pr-3">Error</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id} className="border-b align-top">
                    <td className="py-3 pr-3 text-muted-foreground">{new Date(log.createdAt).toLocaleString()}</td>
                    <td className="py-3 pr-3 font-medium">{log.status}</td>
                    <td className="py-3 pr-3 font-mono text-xs">{log.templateKey || "-"}</td>
                    <td className="py-3 pr-3">{log.recipient}</td>
                    <td className="py-3 pr-3">{log.subject}</td>
                    <td className="py-3 pr-3 text-destructive">{log.error || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}

function Field({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return <div className="space-y-2"><Label>{label}</Label><Input type={type} value={value ?? ""} onChange={(event) => onChange(event.target.value)} /></div>
}

function Editor({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <div className="space-y-2"><Label>{label}</Label><Textarea className="min-h-40 font-mono text-xs" value={value ?? ""} onChange={(event) => onChange(event.target.value)} /></div>
}
