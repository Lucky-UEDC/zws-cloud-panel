"use client"

/**
 * Infrastructure → OS Guest Automation.
 *
 * This is the editor for the commands that configure a customer's server from the
 * inside. Every screen here is built around one rule: an admin can see exactly
 * what a command will do — rendered, masked, and judged against the OS the guest
 * really reports — before it is ever used against a real server.
 *
 * The three things the page refuses to do:
 * - save a template that could not work,
 * - enable a template that could not work,
 * - run a dangerous operation because someone clicked "Test".
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  Activity,
  ChevronDown,
  CircleAlert,
  Loader2,
  Pencil,
  Play,
  Plus,
  Power,
  ShieldCheck,
  Terminal,
  Trash2,
  XCircle,
} from "lucide-react"
import { toast } from "sonner"
import { readJsonResponse } from "@/lib/client/safe-json"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"

type OperationRow = {
  id?: string
  operation: string
  enabled: boolean
  commandType: string
  shell: string | null
  command: string | null
  timeoutSeconds: number
  requiresRunning: boolean
  requiresStopped: boolean
  requiresGuestAgent: boolean
  dangerLevel: string
  requiresConfirmation: boolean
  supportsRollback: boolean
  verificationRequired: boolean
  verificationCommand: string | null
  verificationParser: string | null
  successCondition: string | null
  rollbackCommand: string | null
  stateKey: string | null
  notes: string | null
}

type TemplateRow = {
  id: string
  name: string
  slug: string
  family: string
  osIds: string[]
  versionPattern: string | null
  enabled: boolean
  guestAgentRequired: boolean
  engine: string
  priority: number
  description: string | null
  version: number
  lastTestedAt: string | null
  lastTestResult: Record<string, any> | null
  operations: OperationRow[]
  _count?: { vms: number }
}

type Vocabulary = {
  operations: string[]
  engines: string[]
  shells: string[]
  commandTypes: string[]
  dangerLevels: string[]
  verificationParsers: string[]
  placeholders: string[]
}

type Health = {
  total: number
  enabled: number
  disabled: number
  failed: number
  neverTested: number
  passed: number
  withoutEnabledOperations: number
  families: number
  missingEngines: string[]
  operations: number
  enabledOperations: number
}

type MatrixRow = {
  templateId: string
  name: string
  engine: string
  version: number
  enabled: boolean
  lastTestStatus: string | null
  servers: number
  operations: Array<{ operation: string; present: boolean; enabled: boolean; tested: string | null; dangerLevel: string | null }>
}

type TestServer = { id: string; label: string }

const emptyOperation = (engine: string): OperationRow => ({
  operation: "set_ip",
  enabled: false,
  commandType: "guest-exec",
  shell: engine === "windows" ? "windows-powershell" : "linux-sh",
  command: null,
  timeoutSeconds: 60,
  requiresRunning: true,
  requiresStopped: false,
  requiresGuestAgent: true,
  dangerLevel: "safe",
  requiresConfirmation: false,
  supportsRollback: false,
  verificationRequired: true,
  verificationCommand: null,
  verificationParser: null,
  successCondition: null,
  rollbackCommand: null,
  stateKey: null,
  notes: null,
})

function newTemplate(): TemplateRow {
  return {
    id: "",
    name: "",
    slug: "",
    family: "",
    osIds: [],
    versionPattern: null,
    enabled: false,
    guestAgentRequired: true,
    engine: "linux",
    priority: 100,
    description: null,
    version: 1,
    lastTestedAt: null,
    lastTestResult: null,
    operations: [],
  }
}

export default function OsGuestAutomationPage() {
  const [templates, setTemplates] = useState<TemplateRow[]>([])
  const [health, setHealth] = useState<Health | null>(null)
  const [matrix, setMatrix] = useState<MatrixRow[]>([])
  const [vocabulary, setVocabulary] = useState<Vocabulary | null>(null)
  const [servers, setServers] = useState<TestServer[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  const [editor, setEditor] = useState<TemplateRow | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [structural, setStructural] = useState<string[]>([])
  const [validationErrors, setValidationErrors] = useState<Array<{ path: string; message: string }>>([])

  const [testTarget, setTestTarget] = useState<TemplateRow | null>(null)
  const [testServer, setTestServer] = useState("")
  const [testResults, setTestResults] = useState<Record<string, any> | null>(null)
  const [testing, setTesting] = useState(false)
  const [showMatrix, setShowMatrix] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [list, healthRes, matrixRes, vocabRes] = await Promise.all([
        fetch("/api/admin/guest-os-templates", { cache: "no-store" }),
        fetch("/api/admin/guest-os-templates?view=health", { cache: "no-store" }),
        fetch("/api/admin/guest-os-templates?view=matrix", { cache: "no-store" }),
        fetch("/api/admin/guest-os-templates?view=vocabulary", { cache: "no-store" }),
      ])
      const listData = await readJsonResponse<any>(list)
      setTemplates(Array.isArray(listData?.templates) ? listData.templates : [])
      const healthData = await readJsonResponse<any>(healthRes)
      if (healthData?.health) setHealth(healthData.health)
      const matrixData = await readJsonResponse<any>(matrixRes)
      if (Array.isArray(matrixData?.matrix)) setMatrix(matrixData.matrix)
      const vocabData = await readJsonResponse<any>(vocabRes)
      if (vocabData?.vocabulary) setVocabulary(vocabData.vocabulary)
      const serversData = await readJsonResponse<any>(await fetch("/api/admin/vms?limit=100", { cache: "no-store" }))
      if (Array.isArray(serversData?.vms)) {
        setServers(serversData.vms
          .filter((vps: any) => vps.vmid)
          .map((vps: any) => ({ id: vps.id, label: `${vps.name || vps.hostname || vps.id} · VMID ${vps.vmid}` })))
      }
    } catch (error: any) {
      toast.error(error?.message || "Failed to load guest automation templates")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  function openCreate() {
    setEditor(newTemplate())
    setStructural([])
    setValidationErrors([])
    setEditorOpen(true)
  }

  function openEdit(template: TemplateRow) {
    setEditor({ ...template, operations: template.operations.map((operation) => ({ ...operation })) })
    setStructural([])
    setValidationErrors([])
    setEditorOpen(true)
  }

  async function save() {
    if (!editor) return
    setBusy("save")
    try {
      const payload = {
        ...editor,
        osIds: editor.osIds,
        operations: editor.operations,
      }
      const isNew = !editor.id
      const res = await fetch(isNew ? "/api/admin/guest-os-templates" : `/api/admin/guest-os-templates/${editor.id}`, {
        method: isNew ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const data = await readJsonResponse<any>(res)
      if (!res.ok || data?.success === false) {
        setStructural(data?.structural || [])
        setValidationErrors(data?.errors || [])
        throw new Error(data?.error || "Save failed")
      }
      toast.success(data.note || (isNew ? "Template created" : "Template saved"))
      setEditorOpen(false)
      setEditor(null)
      await load()
    } catch (error: any) {
      toast.error(error?.message || "Save failed")
    } finally {
      setBusy(null)
    }
  }

  async function setEnabled(template: TemplateRow, enabled: boolean) {
    setBusy(`${template.id}:enabled`)
    try {
      const res = await fetch(`/api/admin/guest-os-templates/${template.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: enabled ? "enable" : "disable" }),
      })
      const data = await readJsonResponse<any>(res)
      if (!res.ok || data?.success === false) throw new Error(data?.error || (data?.errors?.[0]?.message) || "Could not change the enabled state")
      toast.success(enabled ? "Template enabled" : "Template disabled")
      await load()
    } catch (error: any) {
      toast.error(error?.message || "Could not change the enabled state")
    } finally {
      setBusy(null)
    }
  }

  async function setOperationEnabled(template: TemplateRow, operation: OperationRow, enabled: boolean) {
    setBusy(`${template.id}:${operation.operation}:enabled`)
    try {
      const res = await fetch(`/api/admin/guest-os-templates/${template.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set_operation_enabled", operation: operation.operation, enabled }),
      })
      const data = await readJsonResponse<any>(res)
      if (!res.ok || data?.success === false) throw new Error(data?.error || "Could not change the operation")
      await load()
    } catch (error: any) {
      toast.error(error?.message || "Could not change the operation")
    } finally {
      setBusy(null)
    }
  }

  async function remove(template: TemplateRow) {
    if (!confirm(`Delete "${template.name}"?`)) return
    setBusy(`${template.id}:delete`)
    try {
      const res = await fetch(`/api/admin/guest-os-templates/${template.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete" }),
      })
      const data = await readJsonResponse<any>(res)
      if (!res.ok || data?.success === false) throw new Error(data?.error || "Delete failed")
      toast.success("Template deleted")
      await load()
    } catch (error: any) {
      toast.error(error?.message || "Delete failed")
    } finally {
      setBusy(null)
    }
  }

  async function runTest(template: TemplateRow, dryRun: boolean, confirmDestructive = false) {
    if (!testServer) {
      toast.error("Choose a server to test against")
      return
    }
    setTesting(true)
    setTestTarget(template)
    setTestResults(null)
    try {
      const res = await fetch(`/api/admin/guest-os-templates/${template.id}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vpsInstanceId: testServer, dryRun, confirmDestructive }),
      })
      const data = await readJsonResponse<any>(res)
      setTestResults(data?.operations ? data : { ...data, operations: {} })
      if (data?.success) toast.success(dryRun ? "Dry run complete — nothing was run" : "Template tested")
      else toast.warning(data?.error || "Test did not pass")
      await load()
    } catch (error: any) {
      toast.error(error?.message || "Test failed")
    } finally {
      setTesting(false)
    }
  }

  const healthCards = useMemo(() => [
    { label: "Templates", value: health?.total ?? 0 },
    { label: "Enabled", value: health?.enabled ?? 0 },
    { label: "Disabled", value: health?.disabled ?? 0 },
    { label: "Failed tests", value: health?.failed ?? 0, tone: (health?.failed ?? 0) > 0 ? "bad" : undefined },
    { label: "Never tested", value: health?.neverTested ?? 0 },
    { label: "OS families", value: health?.families ?? 0 },
    { label: "Enabled operations", value: health?.enabledOperations ?? 0 },
    { label: "Without operations", value: health?.withoutEnabledOperations ?? 0, tone: (health?.withoutEnabledOperations ?? 0) > 0 ? "bad" : undefined },
  ], [health])

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">OS Guest Automation</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            The commands that configure a customer&apos;s server from the inside, through the QEMU guest agent.
            One engine per OS: a Linux command never runs on Windows, and a Windows command never runs on Linux.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={load} className="gap-2"><Activity className="h-4 w-4" />Refresh</Button>
          <Button onClick={openCreate} className="gap-2"><Plus className="h-4 w-4" />New template</Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {healthCards.map((card) => (
          <Card key={card.label}>
            <CardContent className="px-4 py-3">
              <div className="text-xs uppercase text-muted-foreground">{card.label}</div>
              <div className={`mt-1 text-2xl font-semibold ${card.tone === "bad" ? "text-red-300" : ""}`}>{card.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {health?.missingEngines?.length ? (
        <div className="rounded-md border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-200">
          No enabled template exists for the {health.missingEngines.join(" and ")} engine. A guest reporting that OS will be
          told it is unsupported until one is added.
        </div>
      ) : null}

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>Templates</CardTitle>
            <CardDescription>Disabled templates are never used for a new server. Editing one never changes a running server.</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => setShowMatrix((current) => !current)} className="gap-2">
            <ChevronDown className={`h-4 w-4 transition ${showMatrix ? "rotate-180" : ""}`} />
            Test matrix
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {showMatrix ? <TestMatrix matrix={matrix} /> : null}
          {loading ? (
            Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} className="h-16 w-full" />)
          ) : templates.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No guest automation templates yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Template</TableHead>
                    <TableHead>Engine</TableHead>
                    <TableHead>OS ids</TableHead>
                    <TableHead>Version</TableHead>
                    <TableHead>Operations</TableHead>
                    <TableHead>Servers</TableHead>
                    <TableHead>Last test</TableHead>
                    <TableHead>State</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {templates.map((template) => (
                    <TableRow key={template.id}>
                      <TableCell>
                        <div className="font-medium">{template.name}</div>
                        <div className="text-xs text-muted-foreground">{template.family} · {template.slug}</div>
                      </TableCell>
                      <TableCell><Badge variant={template.engine === "windows" ? "outline" : "secondary"}>{template.engine}</Badge></TableCell>
                      <TableCell className="max-w-56 truncate text-xs text-muted-foreground">{(template.osIds || []).join(", ") || "—"}</TableCell>
                      <TableCell className="font-mono text-xs">v{template.version}</TableCell>
                      <TableCell className="text-xs">
                        {template.operations.filter((operation) => operation.enabled).length}/{template.operations.length} enabled
                      </TableCell>
                      <TableCell className="text-xs">{template._count?.vms ?? 0}</TableCell>
                      <TableCell className="text-xs">
                        {template.lastTestedAt
                          ? <Badge variant={(template.lastTestResult as any)?.status === "failed" ? "destructive" : "default"}>
                            {(template.lastTestResult as any)?.status === "failed" ? "Failed" : "Passed"}
                          </Badge>
                          : <span className="text-muted-foreground">Never tested</span>}
                      </TableCell>
                      <TableCell>
                        <Badge variant={template.enabled ? "default" : "secondary"}>{template.enabled ? "Enabled" : "Disabled"}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="ghost" title="Edit" onClick={() => openEdit(template)}><Pencil className="h-4 w-4" /></Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            title={template.enabled ? "Disable" : "Enable"}
                            disabled={busy === `${template.id}:enabled`}
                            onClick={() => setEnabled(template, !template.enabled)}
                          >
                            <Power className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            title="Test on a server"
                            onClick={() => { setTestTarget(template); setTestResults(null) }}
                          >
                            <Play className="h-4 w-4" />
                          </Button>
                          <Button size="sm" variant="ghost" title="Delete" onClick={() => remove(template)}><Trash2 className="h-4 w-4" /></Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {testTarget ? (
        <TestPanel
          template={testTarget}
          servers={servers}
          server={testServer}
          onServer={setTestServer}
          results={testResults}
          testing={testing}
          onClose={() => { setTestTarget(null); setTestResults(null) }}
          onDryRun={() => runTest(testTarget, true)}
          onRun={() => runTest(testTarget, false)}
          onRunDangerous={() => runTest(testTarget, false, true)}
        />
      ) : null}

      {editor && editorOpen ? (
        <TemplateEditor
          template={editor}
          vocabulary={vocabulary}
          structural={structural}
          errors={validationErrors}
          saving={busy === "save"}
          onChange={setEditor}
          onClose={() => { setEditorOpen(false); setEditor(null); setStructural([]); setValidationErrors([]) }}
          onSave={save}
        />
      ) : null}
    </div>
  )
}

function TestMatrix({ matrix }: { matrix: MatrixRow[] }) {
  if (!matrix.length) return <p className="text-sm text-muted-foreground">No templates to show.</p>
  return (
    <div className="overflow-x-auto rounded-md border border-border/40 p-3">
      <p className="mb-2 text-xs text-muted-foreground">
        Every template against every supported operation. A blank cell means the template does not define it, which is
        different from an operation that is defined and untested.
      </p>
      <table className="min-w-full text-[11px]">
        <thead>
          <tr>
            <th className="sticky left-0 bg-background p-1 text-left font-medium">Template</th>
            {matrix[0].operations.map((entry) => (
              <th key={entry.operation} className="p-1 text-left font-medium" title={entry.operation}>{entry.operation.replace(/_/g, " ")}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.map((row) => (
            <tr key={row.templateId} className="border-t border-border/30">
              <td className="sticky left-0 bg-background p-1">
                <span className="font-medium">{row.name}</span>
                <span className="ml-1 text-muted-foreground">v{row.version}{row.enabled ? "" : " (off)"}</span>
              </td>
              {row.operations.map((entry) => (
                <td key={entry.operation} className="p-1">
                  {!entry.present ? <span className="text-muted-foreground/50">—</span>
                    : !entry.enabled ? <span className="text-muted-foreground">off</span>
                      : entry.tested === "failed" ? <span className="text-red-400" title="Last test failed">fail</span>
                        : entry.tested ? <span className="text-emerald-400" title="Last test passed">ok</span>
                          : <span className="text-amber-400" title="Defined but never tested">untested</span>}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function TestPanel({
  template, servers, server, onServer, results, testing, onClose, onDryRun, onRun, onRunDangerous,
}: {
  template: TemplateRow
  servers: TestServer[]
  server: string
  onServer: (value: string) => void
  results: Record<string, any> | null
  testing: boolean
  onClose: () => void
  onDryRun: () => void
  onRun: () => void
  onRunDangerous: () => void
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Test {template.name}</CardTitle>
        <CardDescription>
          A dry run renders every command with sample values and runs nothing. A real test executes the operations
          against the chosen server and verifies each one inside the guest.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2">
          <Label>Server to test against</Label>
          <Select value={server} onValueChange={onServer}>
            <SelectTrigger><SelectValue placeholder="Choose a running server" /></SelectTrigger>
            <SelectContent>{servers.map((entry) => <SelectItem key={entry.id} value={entry.id}>{entry.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={onDryRun} disabled={testing || !server} className="gap-2">
            {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Terminal className="h-4 w-4" />}Dry run
          </Button>
          <Button onClick={onRun} disabled={testing || !server} className="gap-2">
            {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}Run and verify
          </Button>
          <Button variant="outline" onClick={onRunDangerous} disabled={testing || !server} className="gap-2">
            <ShieldCheck className="h-4 w-4" />Include dangerous operations
          </Button>
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </div>
        {results ? <TestResults results={results} /> : null}
      </CardContent>
    </Card>
  )
}

function TestResults({ results }: { results: Record<string, any> }) {
  const operations = Object.entries(results.operations || {}) as Array<[string, any]>
  return (
    <div className="space-y-3 rounded-md border border-border/40 p-3 text-sm">
      {results.error ? (
        <div className="flex items-start gap-2 text-red-300"><CircleAlert className="h-4 w-4 shrink-0" />{results.error}</div>
      ) : null}
      {results.os ? (
        <div className="text-xs text-muted-foreground">
          Guest reports <span className="text-foreground">{results.os}</span> ({results.engine})
          {results.dryRun ? " · dry run, nothing was executed" : ""}
        </div>
      ) : null}
      {operations.length ? (
        <ul className="space-y-2">
          {operations.map(([operation, value]: any) => (
            <li key={operation} className="rounded-md border border-border/30 p-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{operation.replace(/_/g, " ")}</span>
                <Badge variant={value.status === "failed" ? "destructive" : value.status === "dry_run" ? "outline" : value.status === "skipped" ? "secondary" : "default"}>
                  {value.status}
                </Badge>
              </div>
              {value.reason ? <p className="mt-1 text-xs text-muted-foreground">{value.reason}</p> : null}
              {value.error ? <p className="mt-1 text-xs text-red-300">{value.error}</p> : null}
              {value.commandMasked ? (
                <pre className="mt-2 overflow-x-auto rounded bg-muted/40 p-2 text-[11px] leading-5">{value.commandMasked}</pre>
              ) : null}
              {typeof value.durationMs === "number" ? (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {value.durationMs} ms{value.verified ? " · verified inside the guest" : ""}{value.changed ? " · changed" : " · no change"}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

function TemplateEditor({
  template, vocabulary, structural, errors, saving, onChange, onClose, onSave,
}: {
  template: TemplateRow
  vocabulary: Vocabulary | null
  structural: string[]
  errors: Array<{ path: string; message: string }>
  saving: boolean
  onChange: (next: TemplateRow) => void
  onClose: () => void
  onSave: () => void
}) {
  const operations = template.operations || []
  function setOperation(index: number, patch: Partial<OperationRow>) {
    const next = [...operations]
    next[index] = { ...next[index], ...patch }
    onChange({ ...template, operations: next })
  }
  function addOperation() {
    const engine = template.engine
    onChange({ ...template, operations: [...operations, { ...emptyOperation(engine), operation: vocabulary?.operations.find((name) => !operations.some((entry) => entry.operation === name)) || "set_ip" }] })
  }
  function removeOperation(index: number) {
    onChange({ ...template, operations: operations.filter((_, position) => position !== index) })
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="flex max-h-[min(94dvh,900px)] max-w-5xl flex-col overflow-hidden p-0">
        <DialogHeader className="shrink-0 px-6 pt-6">
          <DialogTitle>{template.id ? `Edit ${template.name}` : "New guest automation template"}</DialogTitle>
          <DialogDescription>
            The engine is the only thing that decides which commands may run. A Windows command on a Linux guest, or the
            reverse, is refused before anything is executed.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={template.name} onChange={(event) => onChange({ ...template, name: event.target.value })} placeholder="Debian 12" />
            </div>
            <div className="space-y-2">
              <Label>Slug</Label>
              <Input value={template.slug} onChange={(event) => onChange({ ...template, slug: event.target.value.toLowerCase() })} placeholder="debian-12" />
            </div>
            <div className="space-y-2">
              <Label>Engine</Label>
              <Select value={template.engine} onValueChange={(value) => onChange({ ...template, engine: value })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{(vocabulary?.engines || ["linux", "windows"]).map((engine) => <SelectItem key={engine} value={engine}>{engine}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Family</Label>
              <Input value={template.family} onChange={(event) => onChange({ ...template, family: event.target.value.toLowerCase() })} placeholder="debian" />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>OS ids the guest agent reports</Label>
              <Input
                value={(template.osIds || []).join(", ")}
                onChange={(event) => onChange({ ...template, osIds: event.target.value.split(/[,\s]+/).map((entry) => entry.trim().toLowerCase()).filter(Boolean) })}
                placeholder="debian, ubuntu"
              />
              <p className="text-xs text-muted-foreground">These are matched against the id from <span className="font-mono">qm guest cmd &lt;vmid&gt; get-osinfo</span>. A template that claims no id can never be selected.</p>
            </div>
            <div className="space-y-2">
              <Label>Version pattern (optional)</Label>
              <Input value={template.versionPattern || ""} onChange={(event) => onChange({ ...template, versionPattern: event.target.value || null })} placeholder="^12" />
            </div>
            <div className="space-y-2">
              <Label>Priority</Label>
              <Input type="number" value={template.priority} onChange={(event) => onChange({ ...template, priority: Number(event.target.value) || 0 })} />
              <p className="text-xs text-muted-foreground">Higher wins when more than one template matches the same OS.</p>
            </div>
          </div>

          {errors.length || structural.length ? (
            <div className="space-y-2 rounded-md border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-200">
              {[...structural, ...errors.map((entry) => `${entry.path}: ${entry.message}`)].map((line) => (
                <div key={line} className="flex items-start gap-2"><XCircle className="h-4 w-4 shrink-0" />{line}</div>
              ))}
            </div>
          ) : null}

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Operations</Label>
              <Button size="sm" variant="outline" onClick={addOperation} className="gap-2"><Plus className="h-4 w-4" />Add operation</Button>
            </div>
            {operations.length === 0 ? (
              <p className="text-sm text-muted-foreground">No operations yet. A template with none cannot be enabled.</p>
            ) : operations.map((operation, index) => (
              <OperationEditor
                key={`${operation.operation}-${index}`}
                operation={operation}
                vocabulary={vocabulary}
                onChange={(patch) => setOperation(index, patch)}
                onRemove={() => removeOperation(index)}
              />
            ))}
          </div>
        </div>
        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border/40 bg-background/95 px-6 py-4">
          <p className="text-xs text-muted-foreground">
            Saving does not enable the template. Enable it separately once it has been tested.
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button onClick={onSave} disabled={saving}>{saving ? "Saving..." : "Save template"}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function OperationEditor({
  operation, vocabulary, onChange, onRemove,
}: {
  operation: OperationRow
  vocabulary: Vocabulary | null
  onChange: (patch: Partial<OperationRow>) => void
  onRemove: () => void
}) {
  const isNative = operation.commandType === "guest-native"
  return (
    <div className="space-y-3 rounded-md border border-border/40 p-3">
      <div className="grid gap-3 md:grid-cols-4">
        <div className="space-y-1">
          <Label className="text-xs">Operation</Label>
          <Select value={operation.operation} onValueChange={(value) => onChange({ operation: value })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{(vocabulary?.operations || []).map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Command type</Label>
          <Select value={operation.commandType} onValueChange={(value) => onChange({ commandType: value })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{(vocabulary?.commandTypes || ["guest-exec"]).map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Shell</Label>
          <Select
            value={isNative ? "__none" : operation.shell || ""}
            onValueChange={(value) => onChange({ shell: value === "__none" ? null : value })}
            disabled={isNative}
          >
            <SelectTrigger><SelectValue placeholder={isNative ? "not used by a native verb" : "select"} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none">not used by a native verb</SelectItem>
              {(vocabulary?.shells || []).map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Danger level</Label>
          <Select value={operation.dangerLevel} onValueChange={(value) => onChange({ dangerLevel: value })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{(vocabulary?.dangerLevels || ["safe"]).map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Command</Label>
        <Textarea
          rows={3}
          className="font-mono text-xs"
          value={operation.command || ""}
          onChange={(event) => onChange({ command: event.target.value || null })}
          placeholder={isNative ? "Native verb — the command is the verb name and takes no shell" : "ip address add {{IP}}/{{PREFIX}} dev {{NIC}}"}
          disabled={isNative}
        />
        <p className="text-[11px] text-muted-foreground">
          Available: {(vocabulary?.placeholders || []).map((name) => `{{${name}}}`).join(" ")}
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs">Verification command</Label>
          <Textarea
            rows={2}
            className="font-mono text-xs"
            value={operation.verificationCommand || ""}
            onChange={(event) => onChange({ verificationCommand: event.target.value || null })}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Verification parser</Label>
          <Select value={operation.verificationParser || "none"} onValueChange={(value) => onChange({ verificationParser: value === "none" ? null : value })}>
            <SelectTrigger><SelectValue placeholder="none" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">none</SelectItem>
              {(vocabulary?.verificationParsers || []).map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="space-y-1">
          <Label className="text-xs">Success condition</Label>
          <Input className="font-mono text-xs" value={operation.successCondition || ""} onChange={(event) => onChange({ successCondition: event.target.value || null })} placeholder="exit_code_0" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Timeout (seconds)</Label>
          <Input type="number" className="text-xs" value={operation.timeoutSeconds} onChange={(event) => onChange({ timeoutSeconds: Number(event.target.value) || 60 })} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">State key</Label>
          <Input className="font-mono text-xs" value={operation.stateKey || ""} onChange={(event) => onChange({ stateKey: event.target.value || null })} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 text-xs">
        <label className="flex items-center gap-2"><Checkbox checked={operation.enabled} onCheckedChange={(checked) => onChange({ enabled: checked === true })} />Enabled</label>
        <label className="flex items-center gap-2"><Checkbox checked={operation.verificationRequired} onCheckedChange={(checked) => onChange({ verificationRequired: checked === true })} />Verify after running</label>
        <label className="flex items-center gap-2"><Checkbox checked={operation.requiresRunning} onCheckedChange={(checked) => onChange({ requiresRunning: checked === true })} />Needs a running server</label>
        <label className="flex items-center gap-2"><Checkbox checked={operation.requiresStopped} onCheckedChange={(checked) => onChange({ requiresStopped: checked === true })} />Needs a stopped server</label>
        <label className="flex items-center gap-2"><Checkbox checked={operation.requiresConfirmation} onCheckedChange={(checked) => onChange({ requiresConfirmation: checked === true })} />Ask the customer first</label>
        <label className="flex items-center gap-2"><Checkbox checked={operation.supportsRollback} onCheckedChange={(checked) => onChange({ supportsRollback: checked === true })} />Can be rolled back</label>
        <Button size="sm" variant="ghost" onClick={onRemove} className="ml-auto gap-2 text-red-300"><Trash2 className="h-3.5 w-3.5" />Remove</Button>
      </div>
    </div>
  )
}
