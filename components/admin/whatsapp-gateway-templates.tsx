"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { RefreshCw, Send } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyTitle } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { dedupedAdminErrorToast } from "@/lib/client/admin-toast"
import { readJsonResponse } from "@/lib/client/safe-json"
import { authFetch } from "@/lib/client/auth-fetch"

type TemplateItem = {
  id: string
  templateName: string
  category: string
  language: string
  templateType: string
  status: string
  wabaName: string | null
  createdAt: string
}

type WabaOption = { id: string; name: string | null; externalId: string }

const CATEGORIES = ["MARKETING", "UTILITY", "AUTHENTICATION"] as const
const DEFAULT_LANGUAGES = ["en_US", "en", "hi", "hi_IN", "mr", "ta", "te", "bn", "gu", "kn"] as const

type Draft = {
  wabaId: string
  templateName: string
  category: string
  language: string
  headerText: string
  messageBody: string
  footerText: string
  variableExamples: string
  quickReplies: string
  phoneCallText: string
  phoneNumber: string
  websiteText: string
  websiteUrl: string
  copyCodeText: string
  otpEnabled: boolean
  otpType: "COPY_CODE" | "ONE_TAP"
  codeExpirationMinutes: string
  otpCodeLength: string
}

function initialDraft(): Draft {
  return {
    wabaId: "",
    templateName: "",
    category: "MARKETING",
    language: "en_US",
    headerText: "",
    messageBody: "",
    footerText: "",
    variableExamples: "",
    quickReplies: "",
    phoneCallText: "",
    phoneNumber: "",
    websiteText: "",
    websiteUrl: "",
    copyCodeText: "",
    otpEnabled: false,
    otpType: "COPY_CODE",
    codeExpirationMinutes: "10",
    otpCodeLength: "",
  }
}

function buildVariables(line: string) {
  return line
    .split("\n")
    .map((item) => {
      const [key, ...rest] = item.trim().split(":")
      if (!key || !rest.length) return null
      return { key: key.trim(), example: rest.join(":").trim() }
    })
    .filter((item): item is { key: string; example: string } => Boolean(item))
}

export function WhatsAppGatewayTemplates() {
  const [loading, setLoading] = useState(true)
  const [templates, setTemplates] = useState<TemplateItem[]>([])
  const [wabas, setWabas] = useState<WabaOption[]>([])
  const [draft, setDraft] = useState<Draft>(initialDraft())
  const [submitting, setSubmitting] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  const load = useCallback(async () => {
    const [templateResponse, wabaResponse] = await Promise.all([
      fetch("/api/admin/whatsapp-gateway/templates?page=1&pageSize=100", { headers: { "x-forwarded-for": "127.0.0.1" } }),
      fetch("/api/admin/whatsapp-gateway/connections", { headers: { "x-forwarded-for": "127.0.0.1" } }),
    ])
    const templateBody = (await readJsonResponse<{ items?: TemplateItem[] }>(templateResponse)) || {}
    const wabaBody = (await readJsonResponse<{ connections?: WabaOption[] }>(wabaResponse)) || {}
    if (!templateResponse.ok) dedupedAdminErrorToast({ message: String((templateBody as { error?: string })?.error || "Could not load templates"), key: "gateway-templates" })
    setTemplates(templateBody.items || [])
    setWabas((wabaBody.connections || []).map((waba) => ({ id: waba.id, name: waba.name, externalId: waba.externalId })))
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  const canSubmit = useMemo(() => {
    if (!draft.wabaId || !draft.templateName.trim() || !draft.messageBody.trim()) return false
    const bodyText = draft.messageBody.trim()
    const usedVariables = (bodyText.match(/\{\{([a-zA-Z0-9_]+)\}\}/g) || [])
    const exampleVariables = buildVariables(draft.variableExamples)
    if (usedVariables.length && exampleVariables.length > usedVariables.length) return false
    return true
  }, [draft])

  async function submitTemplate(event: React.FormEvent) {
    event.preventDefault()
    if (!canSubmit) return
    setSubmitting(true)
    try {
      const payload: Record<string, unknown> = {
        wabaId: draft.wabaId,
        templateName: draft.templateName.trim(),
        category: draft.category,
        language: draft.language,
        messageBody: draft.messageBody.trim(),
        footerText: draft.footerText.trim() || undefined,
        headerText: draft.headerText.trim() || undefined,
      }

      const buttons: Record<string, unknown>[] = []
      for (const line of draft.quickReplies.split("\n")) {
        const text = line.trim()
        if (text) buttons.push({ type: "quick_reply", text: text.slice(0, 25) })
      }
      if (draft.phoneCallText.trim() && draft.phoneNumber.trim()) {
        buttons.push({ type: "phone_call", text: draft.phoneCallText.trim().slice(0, 25), phoneNumber: draft.phoneNumber.trim() })
      }
      if (draft.websiteText.trim() && draft.websiteUrl.trim()) {
        buttons.push({ type: "website", text: draft.websiteText.trim().slice(0, 25), websiteUrl: draft.websiteUrl.trim() })
      }
      if (draft.copyCodeText.trim()) {
        buttons.push({ type: "copy_code", text: draft.copyCodeText.trim().slice(0, 25) })
      }
      if (buttons.length) payload.buttons = buttons

      const variables = buildVariables(draft.variableExamples)
      if (variables.length) payload.variableExamples = variables

      if (draft.otpEnabled || draft.category === "AUTHENTICATION") {
        payload.otpButtons = [{ otp_type: draft.otpType, ...(draft.otpType === "COPY_CODE" ? { copy_button_text: "Copy code" } : {}) }]
        payload.addSecurityRecommendation = true
        payload.codeExpirationMinutes = Number(draft.codeExpirationMinutes) || 10
        if (draft.otpCodeLength.trim()) payload.otpCodeLength = Math.min(8, Math.max(4, Number(draft.otpCodeLength)))
      }

      const response = await authFetch("/api/admin/whatsapp-gateway/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const body = (await readJsonResponse<{ template?: { id?: string; templateName?: string; status?: string; sanitizedError?: string } }>(response)) || {}
      if (!response.ok) throw new Error(String((body as { error?: string })?.error || "Template submission failed"))
      const template = body.template
      if (template?.status === "failed") {
        dedupedAdminErrorToast({ message: template.sanitizedError || "Template rejected by provider", key: "gateway-template-reject" })
      } else {
        toast.success("Template submitted")
      }
      setDraft(initialDraft())
      setRefreshKey((key) => key + 1)
    } catch (error) {
      dedupedAdminErrorToast({ message: error instanceof Error ? error.message : "Template submission failed", key: "gateway-template-submit" })
    } finally {
      setSubmitting(false)
    }
  }

  const statusStyles: Record<string, string> = {
    submitted: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
    approved: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    rejected: "bg-destructive/15 text-destructive",
    failed: "bg-destructive/15 text-destructive",
    pending: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  }

  if (loading) return <Skeleton className="h-96 w-full" />

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="text-base">Create template</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={submitTemplate} className="space-y-4">
            <div className="space-y-1.5">
              <Label>WABA</Label>
              <Select value={draft.wabaId} onValueChange={(value) => setDraft((current) => ({ ...current, wabaId: value }))}>
                <SelectTrigger aria-label="WABA"><SelectValue placeholder="Select a connection" /></SelectTrigger>
                <SelectContent>
                  {wabas.length === 0 ? <SelectItem value="__empty__" disabled>Sync connections first (Settings)</SelectItem> : null}
                  {wabas.map((waba) => (
                    <SelectItem key={waba.id} value={waba.id}>{waba.name || waba.externalId}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="templateName">Template name</Label>
              <Input id="templateName" value={draft.templateName} onChange={(event) => setDraft((current) => ({ ...current, templateName: event.target.value }))} placeholder="welcome_message" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Category</Label>
                <Select value={draft.category} onValueChange={(value) => setDraft((current) => ({ ...current, category: value }))}>
                  <SelectTrigger aria-label="Category"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((category) => <SelectItem key={category} value={category}>{category}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Language</Label>
                <Select value={draft.language} onValueChange={(value) => setDraft((current) => ({ ...current, language: value }))}>
                  <SelectTrigger aria-label="Language"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DEFAULT_LANGUAGES.map((language) => <SelectItem key={language} value={language}>{language}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="headerText">Header text (optional)</Label>
              <Input id="headerText" value={draft.headerText} onChange={(event) => setDraft((current) => ({ ...current, headerText: event.target.value }))} placeholder="Hello {{name}}!" />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="messageBody">Message body</Label>
              <Textarea id="messageBody" value={draft.messageBody} onChange={(event) => setDraft((current) => ({ ...current, messageBody: event.target.value }))} rows={4} placeholder="Hi {{name}}, your order #{{order_id}} is confirmed." />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="footerText">Footer (optional)</Label>
              <Input id="footerText" value={draft.footerText} onChange={(event) => setDraft((current) => ({ ...current, footerText: event.target.value }))} placeholder="Powered by ZWS Cloud" />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="variableExamples">Variable examples (one per line: key:value)</Label>
              <Textarea id="variableExamples" value={draft.variableExamples} onChange={(event) => setDraft((current) => ({ ...current, variableExamples: event.target.value }))} rows={3} placeholder={"name:Rahul\norder_id:ORD-1001"} />
            </div>

            <div className="rounded-lg border p-3 space-y-3">
              <p className="text-sm font-medium">Buttons</p>
              <div className="space-y-1.5">
                <Label htmlFor="quickReplies">Quick replies (one per line)</Label>
                <Textarea id="quickReplies" value={draft.quickReplies} onChange={(event) => setDraft((current) => ({ ...current, quickReplies: event.target.value }))} rows={2} placeholder="Yes, confirm" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="phoneCallText">Phone call label</Label>
                  <Input id="phoneCallText" value={draft.phoneCallText} onChange={(event) => setDraft((current) => ({ ...current, phoneCallText: event.target.value }))} placeholder="Call us" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="phoneNumber">Phone number</Label>
                  <Input id="phoneNumber" value={draft.phoneNumber} onChange={(event) => setDraft((current) => ({ ...current, phoneNumber: event.target.value }))} placeholder="919876543210" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="websiteText">Website label</Label>
                  <Input id="websiteText" value={draft.websiteText} onChange={(event) => setDraft((current) => ({ ...current, websiteText: event.target.value }))} placeholder="Visit site" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="websiteUrl">Website URL</Label>
                  <Input id="websiteUrl" value={draft.websiteUrl} onChange={(event) => setDraft((current) => ({ ...current, websiteUrl: event.target.value }))} placeholder="https://..." />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="copyCodeText">Copy code label (optional)</Label>
                <Input id="copyCodeText" value={draft.copyCodeText} onChange={(event) => setDraft((current) => ({ ...current, copyCodeText: event.target.value }))} placeholder="Copy code" />
              </div>
            </div>

            <details className="rounded-lg border p-3">
              <summary className="cursor-pointer text-sm font-medium">One-Tap OTP / Authentication options</summary>
              <div className="mt-3 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">Include OTP button</p>
                    <p className="text-xs text-muted-foreground">Required when category is Authentication. Uses AWS Pinpoint template_type.</p>
                  </div>
                  <input type="checkbox" checked={draft.otpEnabled} onChange={() => setDraft((current) => ({ ...current, otpEnabled: !current.otpEnabled }))} className="size-4 accent-emerald-500" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>OTP type</Label>
                    <Select value={draft.otpType} onValueChange={(value) => setDraft((current) => ({ ...current, otpType: value as "COPY_CODE" | "ONE_TAP" }))}>
                      <SelectTrigger aria-label="OTP type"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="COPY_CODE">Copy code</SelectItem>
                        <SelectItem value="ONE_TAP">One tap</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="codeExpirationMinutes">Code expiration (min)</Label>
                    <Input id="codeExpirationMinutes" type="number" min={1} max={90} value={draft.codeExpirationMinutes} onChange={(event) => setDraft((current) => ({ ...current, codeExpirationMinutes: event.target.value }))} />
                  </div>
                  <div className="space-y-1.5 col-span-2">
                    <Label htmlFor="otpCodeLength">Code length (optional)</Label>
                    <Input id="otpCodeLength" type="number" min={4} max={8} value={draft.otpCodeLength} onChange={(event) => setDraft((current) => ({ ...current, otpCodeLength: event.target.value }))} placeholder="6" />
                  </div>
                </div>
              </div>
            </details>

            <Button type="submit" disabled={submitting || !canSubmit} className="w-full">
              {submitting ? <Spinner className="h-4 w-4" /> : <Send className="h-4 w-4" />}
              Submit Template
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="lg:col-span-3">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Templates</CardTitle>
          <Button variant="outline" size="sm" onClick={() => setRefreshKey((key) => key + 1)}>
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
        </CardHeader>
        <CardContent>
          {templates.length === 0 ? (
            <Empty>
              <EmptyTitle>No templates yet</EmptyTitle>
              <EmptyDescription>Create a template on the left to get started.</EmptyDescription>
            </Empty>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Language</TableHead>
                    <TableHead>WABA</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {templates.map((template) => (
                    <TableRow key={template.id}>
                      <TableCell className="font-mono text-xs">{template.templateName}</TableCell>
                      <TableCell className="text-xs">{template.category}</TableCell>
                      <TableCell className="text-xs capitalize">{template.templateType}</TableCell>
                      <TableCell className="text-xs">{template.language}</TableCell>
                      <TableCell className="max-w-32 truncate text-xs text-muted-foreground">{template.wabaName || "—"}</TableCell>
                      <TableCell>
                        <Badge className={cn("capitalize", statusStyles[template.status] || "")}>{template.status}</Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{String(template.createdAt).slice(0, 10)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}