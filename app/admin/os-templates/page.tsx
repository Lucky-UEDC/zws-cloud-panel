"use client"

import { readJsonResponse } from "@/lib/client/safe-json"
import Image from "next/image"
import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { CheckCircle2, Edit, ExternalLink, Filter, MoreHorizontal, Plus, RefreshCw, Search, Server, ShieldCheck, Star, Trash2, Upload } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { getOsFamily, getResolvedOsIcon, handleOsIconError } from "@/lib/os-icons"
import { Checkbox } from "@/components/ui/checkbox"

type OsGroup = "Windows" | "Ubuntu" | "Rocky Linux" | "AlmaLinux" | "Other Linux" | "Other"
type ConsoleType = "auto" | "novnc" | "xtermjs"

type OsTemplate = {
  id: string
  name: string
  slug: string
  osType: string
  isoPath: string
  iconUrl: string | null
  category: string
  isActive: boolean
  isDefault: boolean
  osFamily: string | null
  osVersion: string | null
  defaultUsername: string | null
  isRecommended: boolean
  eolWarningText: string | null
  sortOrder: number
  source: string | null
  syncedFromProxmox: boolean
  lastSyncedAt: string | null
  proxmoxVmid: number | null
  proxmoxStatus: string | null
  proxmoxTemplateName?: string | null
  guestAgentChannel?: boolean
  reinstallEnabled: boolean
  consoleType: ConsoleType
  resolvedConsoleType?: "novnc" | "xtermjs"
  unsupportedReason: string | null
  warnings?: string[]
  cpu: number | null
  memoryMb: number | null
  diskGb: number | null
  proxmoxStorage?: string | null
  storage?: string | null
  proxmoxNode?: {
    id: string
    name: string
    nodeName: string
  } | null
}

type SyncResult = {
  nodesChecked: number
  templatesFound: number
  imported: number
  updated: number
  failures: Array<{
    nodeId: string
    nodeName: string
    reason: string
  }>
}

type OsStats = {
  total: number
  active: number
  vmTemplates: number
  manual: number
}

type FormState = {
  name: string
  slug: string
  osType: string
  isoPath: string
  iconUrl: string
  category: string
  isActive: boolean
  isDefault: boolean
  osFamily: string
  osVersion: string
  defaultUsername: string
  isRecommended: boolean
  eolWarningText: string
  consoleType: ConsoleType
  sortOrder: string
}

type ConsoleSettings = {
  defaultConsoleType?: ConsoleType
  templateGroupConsoleTypes?: Record<string, ConsoleType>
}

const OS_GROUPS: OsGroup[] = ["Windows", "Ubuntu", "Rocky Linux", "AlmaLinux", "Other Linux", "Other"]

const blankForm: FormState = {
  name: "",
  slug: "",
  osType: "linux",
  isoPath: "",
  iconUrl: "",
  category: "linux",
  isActive: true,
  isDefault: false,
  osFamily: "",
  osVersion: "",
  defaultUsername: "root",
  isRecommended: false,
  eolWarningText: "",
  consoleType: "auto",
  sortOrder: "0",
}

function getOsGroup(input: OsTemplate | string): OsGroup {
  const family = getOsFamily(input)
  if (family === "windows") return "Windows"
  if (family === "ubuntu") return "Ubuntu"
  if (family === "almalinux") return "AlmaLinux"
  if (family === "rocky") return "Rocky Linux"
  if (family === "linux" || family === "debian" || family === "centos" || family === "arch") return "Other Linux"
  return "Other"
}

function versionScore(template: OsTemplate) {
  const raw = `${template.osVersion || ""} ${template.name || ""} ${template.slug || ""}`
  const matches = Array.from(raw.matchAll(/(\d+)(?:[._-](\d+))?/g))
  if (!matches.length) return 0
  const [major, minor] = matches[matches.length - 1].slice(1).map((value) => Number(value || 0))
  return major * 1000 + minor
}

function searchText(template: OsTemplate) {
  return [
    template.name,
    template.slug,
    template.osType,
    template.osFamily,
    template.osVersion,
    template.source,
    template.proxmoxVmid,
    template.proxmoxTemplateName,
    template.proxmoxNode?.name,
    template.proxmoxNode?.nodeName,
  ].filter(Boolean).join(" ").toLowerCase()
}

function templateOsType(template: OsTemplate) {
  const raw = String(template.osType || "").toLowerCase()
  if (raw && raw !== "linux" && raw !== "windows") return raw
  const family = String(template.osFamily || getOsGroup(template)).toLowerCase().replace(/\s+/g, "-")
  return template.osVersion ? `${family}-${template.osVersion}` : raw || family
}

function templateStatus(template: OsTemplate) {
  if (template.isDefault) return "Default"
  return template.isActive ? "Enabled" : "Disabled"
}

function storageNode(template: OsTemplate) {
  const node = template.proxmoxNode ? `${template.proxmoxNode.name} (${template.proxmoxNode.nodeName})` : "-"
  const storage = template.proxmoxStorage || template.storage
  return storage ? `${node} / ${storage}` : node
}

function consoleLabel(value: ConsoleType | string | null | undefined) {
  if (value === "novnc") return "noVNC"
  if (value === "xtermjs") return "xterm.js"
  return "Auto Detect"
}

function groupConsoleKey(group: OsGroup) {
  if (group === "Windows") return "windows"
  if (group === "Ubuntu") return "ubuntu"
  if (group === "Rocky Linux") return "rocky"
  if (group === "AlmaLinux") return "almalinux"
  if (group === "Other Linux") return "linux"
  return "other"
}

export default function OsTemplatesPage() {
  const [templates, setTemplates] = useState<OsTemplate[]>([])
  const [stats, setStats] = useState<OsStats>({ total: 0, active: 0, vmTemplates: 0, manual: 0 })
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null)
  const [syncNotice, setSyncNotice] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<OsTemplate | null>(null)
  const [form, setForm] = useState<FormState>(blankForm)
  const [searchQuery, setSearchQuery] = useState("")
  const [groupFilter, setGroupFilter] = useState<"All" | OsGroup>("All")
  const [nodeFilter, setNodeFilter] = useState("All")
  const [activeFilter, setActiveFilter] = useState("All")
  const [reinstallFilter, setReinstallFilter] = useState("All")
  const [uploadingIcon, setUploadingIcon] = useState(false)
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<Set<string>>(() => new Set())
  const [bulkAction, setBulkAction] = useState("")
  const [bulkLoading, setBulkLoading] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [consoleSettings, setConsoleSettings] = useState<ConsoleSettings>({ defaultConsoleType: "auto", templateGroupConsoleTypes: {} })
  const [consoleSettingsSaving, setConsoleSettingsSaving] = useState(false)

  useEffect(() => {
    void loadTemplates()
    void loadConsoleSettings()
  }, [])

  const visibleTemplates = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    const rows: OsTemplate[] = []

    for (const template of templates) {
      const group = getOsGroup(template)
      if (groupFilter !== "All" && group !== groupFilter) continue
      if (nodeFilter !== "All" && template.proxmoxNode?.id !== nodeFilter) continue
      if (activeFilter !== "All" && String(template.isActive) !== activeFilter) continue
      if (reinstallFilter !== "All" && String(template.reinstallEnabled && !template.unsupportedReason) !== reinstallFilter) continue
      if (query && !searchText(template).includes(query)) continue
      rows.push(template)
    }

    return rows.sort((a, b) => {
        const groupDiff = getOsGroup(a).localeCompare(getOsGroup(b))
        if (groupDiff !== 0) return groupDiff
        const versionDiff = versionScore(b) - versionScore(a)
        if (versionDiff !== 0) return versionDiff
        return String(a.proxmoxNode?.name || "").localeCompare(String(b.proxmoxNode?.name || "")) || a.name.localeCompare(b.name)
      })
  }, [activeFilter, groupFilter, nodeFilter, reinstallFilter, searchQuery, templates])

  const nodeOptions = useMemo(() => {
    const map = new Map<string, { id: string; label: string }>()
    for (const template of templates) {
      if (!template.proxmoxNode?.id) continue
      map.set(template.proxmoxNode.id, {
        id: template.proxmoxNode.id,
        label: `${template.proxmoxNode.name} (${template.proxmoxNode.nodeName})`,
      })
    }
    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label))
  }, [templates])

  const visibleCount = visibleTemplates.length
  const visibleIds = useMemo(() => visibleTemplates.map((template) => template.id), [visibleTemplates])
  const selectedIds = useMemo(() => Array.from(selectedTemplateIds), [selectedTemplateIds])
  const selectedCount = selectedIds.length
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedTemplateIds.has(id))
  const someVisibleSelected = visibleIds.some((id) => selectedTemplateIds.has(id))

  function toggleTemplateSelection(id: string, checked: boolean) {
    setSelectedTemplateIds((current) => {
      const next = new Set(current)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  function toggleVisibleSelection(checked: boolean) {
    setSelectedTemplateIds((current) => {
      const next = new Set(current)
      for (const id of visibleIds) {
        if (checked) next.add(id)
        else next.delete(id)
      }
      return next
    })
  }

  async function loadTemplates() {
    setLoading(true)
    setLoadError(null)
    try {
      const res = await fetch("/api/admin/os-templates")
      const data = await readJsonResponse<any>(res)
      if (!res.ok) throw new Error(data?.error || "Failed to load templates")
      setTemplates(Array.isArray(data?.items) ? data.items : [])
      setStats({
        total: Number(data?.stats?.total || 0),
        active: Number(data?.stats?.active || 0),
        vmTemplates: Number(data?.stats?.vmTemplates || 0),
        manual: Number(data?.stats?.manual || 0),
      })
    } catch (error: any) {
      console.error("Admin fetch failed:", error)
      const message = error?.message || "Unable to load operating systems right now."
      setLoadError(message)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }

  function openManualDialog(template?: OsTemplate) {
    if (template) {
      setEditingTemplate(template)
      setForm({
        name: template.name,
        slug: template.slug,
        osType: template.osType,
        isoPath: template.isoPath,
        iconUrl: template.iconUrl || "",
        category: template.category || "linux",
        isActive: template.isActive,
        isDefault: template.isDefault,
        osFamily: template.osFamily || "",
        osVersion: template.osVersion || "",
        defaultUsername: template.defaultUsername || "root",
        isRecommended: Boolean(template.isRecommended),
        eolWarningText: template.eolWarningText || "",
        consoleType: template.consoleType || "auto",
        sortOrder: String(template.sortOrder ?? 0),
      })
    } else {
      setEditingTemplate(null)
      setForm(blankForm)
    }
    setIsDialogOpen(true)
  }

  async function loadConsoleSettings() {
    try {
      const res = await fetch("/api/admin/console-settings")
      const data = await readJsonResponse<any>(res)
      if (!res.ok) throw new Error(data?.error || "Failed to load console settings")
      setConsoleSettings({
        defaultConsoleType: data?.defaultConsoleType || data?.value?.defaultConsoleType || "auto",
        templateGroupConsoleTypes: data?.templateGroupConsoleTypes || data?.value?.templateGroupConsoleTypes || {},
      })
    } catch {
      setConsoleSettings({ defaultConsoleType: "auto", templateGroupConsoleTypes: {} })
    }
  }

  async function saveConsoleSettings(next: ConsoleSettings) {
    setConsoleSettingsSaving(true)
    try {
      const payload = { ...consoleSettings, ...next }
      const res = await fetch("/api/admin/console-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const data = await readJsonResponse<any>(res)
      if (!res.ok) throw new Error(data?.error || "Console settings save failed")
      const saved = data?.value || payload
      setConsoleSettings({
        defaultConsoleType: saved.defaultConsoleType || "auto",
        templateGroupConsoleTypes: saved.templateGroupConsoleTypes || {},
      })
      toast.success("Console access settings saved")
    } catch (error: any) {
      toast.error(error?.message || "Console settings save failed")
    } finally {
      setConsoleSettingsSaving(false)
    }
  }

  async function updateTemplateGroupConsole(group: OsGroup, value: ConsoleType) {
    const key = groupConsoleKey(group)
    await saveConsoleSettings({
      templateGroupConsoleTypes: {
        ...(consoleSettings.templateGroupConsoleTypes || {}),
        [key]: value,
      },
    })
  }

  async function handleIconUpload(file: File) {
    setUploadingIcon(true)
    try {
      const formData = new FormData()
      formData.append("file", file)
      const res = await fetch("/api/admin/os-templates/upload-icon", { method: "POST", body: formData })
      const data = await readJsonResponse<any>(res)
      if (!res.ok) throw new Error(data?.error || "Icon upload failed")
      setForm((current) => ({ ...current, iconUrl: String(data.url || "") }))
      toast.success("OS icon uploaded")
    } catch (error: any) {
      console.error("Admin fetch failed:", error)
      toast.error(error?.message || "Icon upload failed")
    } finally {
      setUploadingIcon(false)
    }
  }

  async function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const payload = {
      ...form,
      isActive: Boolean(form.isActive),
      isDefault: Boolean(form.isDefault),
      sortOrder: Number(form.sortOrder) || 0,
    }

    try {
      const url = editingTemplate
        ? `/api/admin/os-templates/${editingTemplate.id}`
        : "/api/admin/os-templates"
      const method = editingTemplate ? "PUT" : "POST"
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const data = await readJsonResponse<any>(res)
      if (!res.ok) throw new Error(data?.error || "Save failed")

      toast.success(editingTemplate ? "Template updated" : "Manual template added")
      setIsDialogOpen(false)
      setEditingTemplate(null)
      setForm(blankForm)
      await loadTemplates()
    } catch (error: any) {
      console.error("Admin fetch failed:", error)
      toast.error(error?.message || "Save failed")
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Are you sure you want to delete this template?")) return
    try {
      const res = await fetch(`/api/admin/os-templates/${id}`, { method: "DELETE" })
      const data = await readJsonResponse<any>(res)
      if (!res.ok) throw new Error(data?.error || "Delete failed")
      toast.success("Template deleted")
      await loadTemplates()
    } catch (error: any) {
      console.error("Admin fetch failed:", error)
      toast.error(error?.message || "Delete failed")
    }
  }

  async function runBulkAction(actionOverride?: string) {
    const action = actionOverride || bulkAction
    if (!action || !selectedIds.length) return
    if (action === "delete") {
      setDeleteConfirmOpen(true)
      return
    }
    let targetNodeId = ""
    if (action === "move") {
      targetNodeId = window.prompt("Target node ID for matching templates") || ""
      if (!targetNodeId.trim()) return
    }
    setBulkLoading(true)
    try {
      const res = await fetch("/api/admin/os-templates/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ids: selectedIds, targetNodeId }),
      })
      const data = await readJsonResponse<any>(res)
      if (!res.ok || data?.success === false) throw new Error(data?.error || "Bulk action failed")
      toast.success(`Bulk ${action} complete`)
      setSelectedTemplateIds(new Set())
      setBulkAction("")
      await loadTemplates()
    } catch (error: any) {
      toast.error(error?.message || "Bulk action failed")
    } finally {
      setBulkLoading(false)
    }
  }

  async function confirmBulkDelete() {
    setBulkLoading(true)
    try {
      const res = await fetch("/api/admin/os-templates/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", ids: selectedIds, confirm: "DELETE" }),
      })
      const data = await readJsonResponse<any>(res)
      if (!res.ok || data?.success === false) throw new Error(data?.error || "Bulk delete failed")
      toast.success(`Deleted ${data.deleted || selectedCount} templates`)
      setDeleteConfirmOpen(false)
      setSelectedTemplateIds(new Set())
      setBulkAction("")
      await loadTemplates()
    } catch (error: any) {
      toast.error(error?.message || "Bulk delete failed")
    } finally {
      setBulkLoading(false)
    }
  }

  async function handleQuickUpdate(template: OsTemplate, patch: Partial<Pick<OsTemplate, "isActive" | "isDefault" | "reinstallEnabled" | "consoleType">>) {
    try {
      const res = await fetch(`/api/admin/os-templates/${template.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: template.name,
          slug: template.slug,
          osType: template.osType,
          isoPath: template.isoPath,
          iconUrl: template.iconUrl || "",
          category: template.category || "linux",
          osFamily: template.osFamily || "",
          osVersion: template.osVersion || "",
          defaultUsername: template.defaultUsername || "root",
          isRecommended: Boolean(template.isRecommended),
          eolWarningText: template.eolWarningText || "",
          consoleType: patch.consoleType ?? template.consoleType ?? "auto",
          sortOrder: Number(template.sortOrder || 0),
          isActive: patch.isActive ?? template.isActive,
          isDefault: patch.isDefault ?? template.isDefault,
          reinstallEnabled: patch.reinstallEnabled ?? template.reinstallEnabled,
        }),
      })
      const data = await readJsonResponse<any>(res)
      if (!res.ok) throw new Error(data?.error || "Template update failed")
      toast.success("Template updated")
      await loadTemplates()
    } catch (error: any) {
      toast.error(error?.message || "Template update failed")
    }
  }

  async function handleSync(nodeId?: string) {
    if (syncing) return
    setSyncing(true)
    setSyncResult(null)
    setSyncNotice(null)
    try {
      const res = await fetch("/api/admin/os-templates/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nodeId: nodeId || null, templatesOnly: true }),
      })
      const data = await readJsonResponse<any>(res)
      if (!res.ok || !data.success) throw new Error(data?.error || "Failed to sync templates")
      setSyncResult(data.result)
      toast.success(`Synced ${data.result.imported} imported, ${data.result.updated} updated`)
      await loadTemplates()
    } catch (error: any) {
      console.error("Admin fetch failed:", error)
      const message = error?.message || "Failed to sync templates"
      toast.error(message)
      if (message.includes("Add and test a node first")) {
        setSyncNotice("Add and test a node first before syncing templates.")
        setSyncResult({
          nodesChecked: 0,
          templatesFound: 0,
          imported: 0,
          updated: 0,
          failures: [],
        })
      }
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Operating Systems</h1>
          <p className="mt-1 text-sm text-muted-foreground">Manage the Proxmox template catalog used by provisioning and reinstall workflows.</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Button onClick={() => handleSync()} disabled={syncing} className="gap-2">
            {syncing ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Server className="h-4 w-4" />}
            {syncing ? "Syncing templates..." : "Sync From Servers"}
          </Button>
          {nodeFilter !== "All" ? (
            <Button variant="outline" onClick={() => handleSync(nodeFilter)} disabled={syncing} className="gap-2">
              <RefreshCw className="h-4 w-4" />
              Sync Selected Node
            </Button>
          ) : null}
          <Button variant="outline" onClick={() => openManualDialog()} className="gap-2">
            <Plus className="h-4 w-4" />
            Add Manual Operating System
          </Button>
        </div>
      </div>

      {loadError ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
          Unable to load operating systems right now. {loadError}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total Operating Systems" value={stats.total} icon={Server} />
        <StatCard label="Active" value={stats.active} icon={ShieldCheck} />
        <StatCard label="VM Templates" value={stats.vmTemplates} icon={Star} />
        <StatCard label="Manual" value={stats.manual} icon={CheckCircle2} />
      </div>

      <Card className="glass border-border/40">
        <CardHeader>
          <CardTitle>Console Access Defaults</CardTitle>
          <CardDescription>Template settings override group settings. Auto Detect resolves Windows to noVNC and Linux to xterm.js.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <div className="space-y-2">
            <Label>System Default</Label>
            <select
              value={consoleSettings.defaultConsoleType || "auto"}
              disabled={consoleSettingsSaving}
              onChange={(event) => void saveConsoleSettings({ defaultConsoleType: event.target.value as ConsoleType })}
              className="h-10 w-full rounded-md border border-border/40 bg-background px-3 text-sm"
            >
              <option value="auto">Auto Detect</option>
              <option value="novnc">noVNC</option>
              <option value="xtermjs">xterm.js</option>
            </select>
          </div>
          {OS_GROUPS.map((group) => {
            const key = groupConsoleKey(group)
            return (
              <div key={group} className="space-y-2">
                <Label>{group}</Label>
                <select
                  value={(consoleSettings.templateGroupConsoleTypes || {})[key] || "auto"}
                  disabled={consoleSettingsSaving}
                  onChange={(event) => void updateTemplateGroupConsole(group, event.target.value as ConsoleType)}
                  className="h-10 w-full rounded-md border border-border/40 bg-background px-3 text-sm"
                >
                  <option value="auto">Auto Detect</option>
                  <option value="novnc">noVNC</option>
                  <option value="xtermjs">xterm.js</option>
                </select>
              </div>
            )
          })}
        </CardContent>
      </Card>

      {syncNotice ? (
        <Card className="glass border-border/40">
          <CardContent className="pt-6 text-sm text-muted-foreground">{syncNotice}</CardContent>
        </Card>
      ) : null}

      {syncResult ? (
        <Card className="glass border-border/40">
          <CardHeader>
            <CardTitle>Last Sync Result</CardTitle>
            <CardDescription>
              Nodes checked: {syncResult.nodesChecked} | VM templates found: {syncResult.templatesFound} | Imported: {syncResult.imported} | Updated: {syncResult.updated} | Failures: {syncResult.failures.length}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      <Card className="glass border-border/40">
        <CardHeader className="gap-4 px-4 py-3">
          <div>
            <CardTitle>Template Catalog</CardTitle>
            <CardDescription>Full metadata view for each manual and Proxmox-backed template.</CardDescription>
          </div>
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_180px_220px_180px_180px]">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                className="pl-9"
                placeholder="Search Ubuntu, Debian, VMID, node, source..."
              />
            </label>
            <select
              value={activeFilter}
              onChange={(event) => setActiveFilter(event.target.value)}
              className="h-10 w-full rounded-md border border-border/40 bg-background px-3 text-sm"
            >
              <option value="All">All statuses</option>
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </select>
            <label className="relative block">
              <Filter className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <select
                value={groupFilter}
                onChange={(event) => setGroupFilter(event.target.value as "All" | OsGroup)}
                className="h-10 w-full rounded-md border border-border/40 bg-background px-9 text-sm"
              >
                <option value="All">All groups</option>
                {OS_GROUPS.map((group) => <option key={group} value={group}>{group}</option>)}
              </select>
            </label>
            <select
              value={nodeFilter}
              onChange={(event) => setNodeFilter(event.target.value)}
              className="h-10 w-full rounded-md border border-border/40 bg-background px-3 text-sm"
            >
              <option value="All">All nodes</option>
              {nodeOptions.map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}
            </select>
            <select
              value={reinstallFilter}
              onChange={(event) => setReinstallFilter(event.target.value)}
              className="h-10 w-full rounded-md border border-border/40 bg-background px-3 text-sm"
            >
              <option value="All">All support</option>
              <option value="true">Reinstall supported</option>
              <option value="false">Unsupported</option>
            </select>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto px-4 pb-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <select
              value={bulkAction}
              onChange={(event) => setBulkAction(event.target.value)}
              className="h-9 w-full rounded-md border border-border/40 bg-background px-3 text-sm sm:w-56"
            >
              <option value="">Bulk actions</option>
              <option value="delete">Delete selected</option>
              <option value="disable">Disable selected</option>
              <option value="enable">Enable selected</option>
              <option value="sync">Sync selected</option>
              <option value="move">Move selected</option>
            </select>
            <Button size="sm" variant="outline" disabled={!bulkAction || !selectedCount || bulkLoading} onClick={() => void runBulkAction()}>
              {bulkLoading ? "Applying..." : "Apply"}
            </Button>
            <span className="text-xs text-muted-foreground">{selectedCount} selected</span>
            {selectedCount ? <Button size="sm" variant="ghost" onClick={() => setSelectedTemplateIds(new Set())}>Clear</Button> : null}
          </div>
          {loading ? (
            <div className="rounded-md border border-border/40 bg-foreground/[0.02] p-8 text-center text-sm text-muted-foreground">Loading operating systems...</div>
          ) : templates.length === 0 ? (
            <div className="rounded-md border border-border/40 bg-foreground/[0.02] p-8 text-center text-sm text-muted-foreground">No operating systems configured.</div>
          ) : visibleCount === 0 ? (
            <div className="rounded-md border border-border/40 bg-foreground/[0.02] p-8 text-center text-sm text-muted-foreground">No operating systems match the current search and filter.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={allVisibleSelected ? true : someVisibleSelected ? "indeterminate" : false}
                      onCheckedChange={(checked) => toggleVisibleSelection(checked === true)}
                      aria-label="Select all visible templates"
                    />
                  </TableHead>
                  <TableHead>OS Group</TableHead>
                  <TableHead>OS Type</TableHead>
                  <TableHead>VMID</TableHead>
                  <TableHead>Template Name</TableHead>
                  <TableHead>Storage Node</TableHead>
                  <TableHead>Disk Size</TableHead>
                  <TableHead>Guest agent</TableHead>
                  <TableHead>Console Access</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last synced</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleTemplates.map((template) => (
                  <TableRow key={template.id}>
                    <TableCell>
                      <Checkbox
                        checked={selectedTemplateIds.has(template.id)}
                        onCheckedChange={(checked) => toggleTemplateSelection(template.id, checked === true)}
                        aria-label={`Select ${template.name}`}
                      />
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <span className="inline-flex items-center gap-2">
                        <Image src={getResolvedOsIcon(template)} alt="" width={20} height={20} className="h-5 w-5 rounded bg-foreground/[0.04] p-0.5" onError={handleOsIconError} unoptimized />
                        {getOsGroup(template)}
                      </span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap font-mono text-xs">{templateOsType(template)}</TableCell>
                    <TableCell className="font-mono">{template.proxmoxVmid ?? "-"}</TableCell>
                    <TableCell className="min-w-56">
                      <div className="truncate font-medium">{template.name}</div>
                      <div className="truncate text-xs text-muted-foreground">{template.slug}</div>
                    </TableCell>
                    <TableCell className="min-w-52 text-xs">{storageNode(template)}</TableCell>
                    <TableCell className="whitespace-nowrap">{formatDisk(template.diskGb)}</TableCell>
                    <TableCell><Badge variant={template.guestAgentChannel ? "default" : "destructive"}>{template.guestAgentChannel ? "Channel open" : "No channel"}</Badge></TableCell>
                    <TableCell className="min-w-40">
                      <select
                        value={template.consoleType || "auto"}
                        onChange={(event) => void handleQuickUpdate(template, { consoleType: event.target.value as ConsoleType })}
                        className="h-9 w-full rounded-md border border-border/40 bg-background px-2 text-xs"
                        aria-label={`Console access for ${template.name}`}
                      >
                        <option value="auto">Auto Detect</option>
                        <option value="novnc">noVNC</option>
                        <option value="xtermjs">xterm.js</option>
                      </select>
                      <div className="mt-1 text-[11px] text-muted-foreground">Resolved: {consoleLabel(template.resolvedConsoleType || template.consoleType)}</div>
                    </TableCell>
                    <TableCell><Badge variant={template.isDefault ? "default" : template.isActive ? "outline" : "secondary"}>{templateStatus(template)}</Badge></TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{formatDate(template.lastSyncedAt)}</TableCell>
                    <TableCell className="text-right">
                      <TemplateRowOptions
                        template={template}
                        onEdit={() => openManualDialog(template)}
                        onDelete={() => handleDelete(template.id)}
                        onEnable={() => handleQuickUpdate(template, { isActive: true, reinstallEnabled: true })}
                        onDisable={() => handleQuickUpdate(template, { isActive: false, reinstallEnabled: false })}
                        onDefault={() => handleQuickUpdate(template, { isDefault: true, isActive: true, reinstallEnabled: true })}
                        onSync={() => template.proxmoxNode?.id ? handleSync(template.proxmoxNode.id) : handleSync()}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{editingTemplate ? "Edit Operating System" : "Add Manual Operating System"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name" value={form.name} onChange={(value) => setForm((current) => ({ ...current, name: value }))} />
              <Field label="Slug" value={form.slug} onChange={(value) => setForm((current) => ({ ...current, slug: value }))} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="OS Type" value={form.osType} onChange={(value) => setForm((current) => ({ ...current, osType: value }))} />
              <Field label="ISO Path / Volume ID" value={form.isoPath} onChange={(value) => setForm((current) => ({ ...current, isoPath: value }))} />
            </div>
            <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
              <Field label="Icon URL" value={form.iconUrl} onChange={(value) => setForm((current) => ({ ...current, iconUrl: value }))} required={false} />
              <div className="space-y-2">
                <Label>Preview</Label>
                <div className="flex h-10 items-center justify-center rounded-md border border-border/40 bg-foreground/[0.03]">
                  <Image
                    src={getResolvedOsIcon({
                      name: form.name,
                      slug: form.slug,
                      osFamily: form.osFamily,
                      category: form.category,
                      iconUrl: form.iconUrl,
                    })}
                    alt=""
                    width={28}
                    height={28}
                    className="h-7 w-7 object-contain"
                    onError={handleOsIconError}
                    unoptimized
                  />
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Upload OS Icon (PNG/SVG)</Label>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Input
                  type="file"
                  accept="image/png,image/svg+xml,image/webp,image/jpeg"
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    if (file) void handleIconUpload(file)
                    event.target.value = ""
                  }}
                />
                <Button type="button" variant="outline" disabled={uploadingIcon} className="gap-2">
                  <Upload className="h-4 w-4" />
                  {uploadingIcon ? "Uploading..." : "Upload"}
                </Button>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Category" value={form.category} onChange={(value) => setForm((current) => ({ ...current, category: value }))} />
              <Field label="OS Family" value={form.osFamily} onChange={(value) => setForm((current) => ({ ...current, osFamily: value }))} required={false} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Version" value={form.osVersion} onChange={(value) => setForm((current) => ({ ...current, osVersion: value }))} required={false} />
              <Field label="Default Username" value={form.defaultUsername} onChange={(value) => setForm((current) => ({ ...current, defaultUsername: value }))} required={false} />
            </div>
            <div className="space-y-2">
              <Label>Console Access</Label>
              <select
                value={form.consoleType}
                onChange={(event) => setForm((current) => ({ ...current, consoleType: event.target.value as ConsoleType }))}
                className="h-10 w-full rounded-md border border-border/40 bg-background px-3 text-sm"
              >
                <option value="auto">Auto Detect</option>
                <option value="novnc">noVNC</option>
                <option value="xtermjs">xterm.js</option>
              </select>
            </div>
            <Field label="EOL Warning Text" value={form.eolWarningText} onChange={(value) => setForm((current) => ({ ...current, eolWarningText: value }))} required={false} />
            <div className="grid gap-3 sm:grid-cols-4">
              <Field label="Sort Order" value={form.sortOrder} onChange={(value) => setForm((current) => ({ ...current, sortOrder: value }))} type="number" />
              <ToggleField label="Active" checked={form.isActive} onChange={(value) => setForm((current) => ({ ...current, isActive: value }))} />
              <ToggleField label="Default" checked={form.isDefault} onChange={(value) => setForm((current) => ({ ...current, isDefault: value }))} />
              <ToggleField label="Recommended" checked={form.isRecommended} onChange={(value) => setForm((current) => ({ ...current, isRecommended: value }))} />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button>
              <Button type="submit">{editingTemplate ? "Save Changes" : "Save Manual Operating System"}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete selected templates</DialogTitle>
            <DialogDescription>
              This will delete {selectedCount} template{selectedCount === 1 ? "" : "s"} and clear related order, VM, offer, provisioning, and cache mappings.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleteConfirmOpen(false)} disabled={bulkLoading}>Cancel</Button>
            <Button type="button" variant="destructive" onClick={() => void confirmBulkDelete()} disabled={bulkLoading}>{bulkLoading ? "Deleting..." : "Delete"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function TemplateRowOptions({
  template,
  onEdit,
  onDelete,
  onEnable,
  onDisable,
  onDefault,
  onSync,
}: {
  template: OsTemplate
  onEdit: () => void
  onDelete: () => void
  onEnable: () => void
  onDisable: () => void
  onDefault: () => void
  onSync: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" size="sm" variant="outline" className="gap-2">
          <MoreHorizontal className="h-4 w-4" />
          Options
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Template options</DropdownMenuLabel>
        <DropdownMenuItem onClick={onEnable}>Enable template</DropdownMenuItem>
        <DropdownMenuItem onClick={onDisable}>Disable template</DropdownMenuItem>
        <DropdownMenuItem onClick={onDefault}>Set as default</DropdownMenuItem>
        <DropdownMenuItem onClick={onSync}><RefreshCw className="mr-2 h-4 w-4" />Sync template</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onEdit}><Edit className="mr-2 h-4 w-4" />Edit metadata</DropdownMenuItem>
        {template.proxmoxNode ? (
          <DropdownMenuItem asChild>
            <Link href={`/admin/compute-nodes/${template.proxmoxNode.id}#templates`}><ExternalLink className="mr-2 h-4 w-4" />Open node templates</Link>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={onDelete}><Trash2 className="mr-2 h-4 w-4" />Delete template</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function StatCard({ label, value, icon: Icon }: { label: string; value: number; icon: any }) {
  return (
    <div className="glass rounded-xl p-5 transition-all hover:scale-[1.02]">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{label}</span>
        <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--surface-subtle)] p-2">
          <Icon className="h-4 w-4 text-primary" />
        </div>
      </div>
      <p className="mt-3 text-3xl font-semibold tabular-nums">{value.toLocaleString()}</p>
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  required = true,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: string
  required?: boolean
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input value={value} onChange={(event) => onChange(event.target.value)} type={type} required={required} />
    </div>
  )
}

function ToggleField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex h-10 items-center gap-2 rounded-md border border-border/40 px-3 text-sm">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  )
}

function formatDate(value: string | null) {
  if (!value) return "-"
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))
}

function formatDisk(value: number | null) {
  if (!value || !Number.isFinite(value)) return "-"
  return `${value.toFixed(1)} GB`
}
