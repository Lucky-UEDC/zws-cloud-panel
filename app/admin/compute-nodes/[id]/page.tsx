"use client"

import { readJsonResponse } from "@/lib/client/safe-json"
import Link from "next/link"
import { useParams } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import { Activity, ArrowLeft, Check, Copy, Cpu, Database, Edit, Eye, ExternalLink, MemoryStick, MoreHorizontal, Network, Pause, Play, RefreshCw, Save, Search, Server, ShieldCheck, Star, Trash2, Upload, Wifi } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { bytesToDecimalGb, formatByteRateDecimal, formatBytesDecimal } from "@/lib/format-units"

type NodeDetail = {
  node: { id: string; name: string; host: string; nodeName: string; location: string | null; lastCheckedAt: string | null }
  status: "connected" | "warning" | "failed"
  checkedAt: string
  error?: string
  health: { status: string; critical: boolean }
  cpu: { usagePercent: number; totalCores: number; totalSockets: number; model: string | null; loadAverage: string }
  memory: { used: string; free: string; total: string; usagePercent: number; usedBytes?: number; totalBytes?: number }
  disk: { used: string; free: string; total: string; usagePercent: number; usedBytes?: number; totalBytes?: number }
  network: { inbound: string; outbound: string; inboundBytes?: number; outboundBytes?: number }
  uptime: { readable: string; seconds?: number }
  loadAverage: string
  version: { proxmox: string | null; kernel: string | null }
  serverTime: { time: string | null; timezone: string | null }
  storage: Array<{ name: string; type: string; total: string; used: string; free: string; usagePercent: number; active: boolean | null; enabled: boolean | null; totalBytes?: number; usedBytes?: number; freeBytes?: number }>
  guests: Array<{ vmid: number; name: string; type: string; status: string; cpuCores: number; memory: string; disk: string; ipAddress: string | null; template: boolean; os?: string | null; uptime?: string | null }>
  vmSummary: { running: number; stopped: number; templates: number; failedUnknown: number; total: number }
  templates?: Array<{ vmid?: number; name: string; storage?: string | null; source?: string; status?: string | null; size?: string }>
  isos?: Array<{ name: string; storage?: string | null; size?: string; volid?: string }>
  tasks?: Array<{ upid: string; type: string; status: string; exitstatus?: string | null; user?: string | null; vmid?: string | number | null; starttime?: string | null; endtime?: string | null }>
  events?: Array<{ id: string; time: string; node?: string | null; user?: string | null; severity?: string | null; message: string }>
  activeProvisioningJobs?: Array<{ id: string; orderId: string; vmid?: number | null; status: string; currentStep?: string | null; displayStatus?: string | null; createdAt: string }>
  provisionCapacity?: { allowed: boolean; priority: "normal" | "low" | "blocked"; state: string; vmCount: number; maxVmCapacity: number | null; remainingVmCapacity: number | null }
  nodeBandwidth?: { totalBytes: number; rxBytes: number; txBytes: number; peakRateBps: number; total: string; inbound: string; outbound: string; peakRate: string }
  errors: Record<string, string>
}

type LiveMetrics = {
  status: "connected" | "warning" | "failed"
  cpuUsage: number
  cpuCores: number
  memoryUsed: string
  memoryTotal: string
  memoryUsedBytes: number
  memoryTotalBytes: number
  memoryUsage: number
  diskUsed: string
  diskTotal: string
  diskUsedBytes: number
  diskTotalBytes: number
  diskUsage: number
  uptime: string
  uptimeSeconds: number
  loadAverage: string
  networkIn: string
  networkOut: string
  networkInBytes: number
  networkOutBytes: number
  runningInstances: number
  stoppedInstances: number
  templates: number
  failedUnknown: number
  totalGuests: number
  health: { status: string; critical: boolean }
  errors: Record<string, string>
  refreshedAt: string
}

type LiveSample = {
  at: number
  cpu: number
  memory: number
  disk: number
  networkIn: number
  networkOut: number
}

type NodeMetricStream = {
  cpuUsage: number
  ramUsage: number
  diskUsage: number
  diskRead: number
  diskWrite: number
  networkIn: number
  networkOut: number
  load1: number
  load5: number
  load15: number
  uptime: number
  runningVms: number
  stoppedVms: number
  storageUsed: number
  storageFree: number
  temperature: number | null
  latencyMs: number | null
  activeTasks: number
  taskQueue: number
  health: string
  recordedAt: string
}

type LiveLog = {
  id: string
  source: string
  level: string
  event: string
  message: string
  createdAt: string
  metadata?: Record<string, unknown>
}

type StorageConfig = {
  id: string
  storageId: string
  proxmoxStorageId?: string
  displayName?: string | null
  type?: string | null
  storageType?: string | null
  diskClass?: string | null
  customStorageLabel?: string | null
  customDiskLabel?: string | null
  totalBytes?: number | string | null
  usedBytes?: number | string | null
  freeBytes?: number | string | null
  availableBytes?: number | string | null
  enabled: boolean
  defaultForNewVm: boolean
  defaultForVmDisk?: boolean
  defaultDiskTarget?: boolean
  defaultForTemplate?: boolean
  defaultTemplateTarget?: boolean
  defaultForBackup?: boolean
  backupStorage?: boolean
  priority?: number | string
  storagePriority?: number | string
  healthStatus?: string | null
  supportedContent?: string[] | null
  lastHealthCheckedAt?: string | null
  sortOrder?: number | string | null
  premium: boolean
  isPremium?: boolean
  allowNewPurchase: boolean
  allowUpgrade: boolean
  isCustomerSelectable?: boolean
  isUpgradeOnly?: boolean
  minGb?: number | string | null
  maxGb?: number | string | null
  minDiskSizeGb?: number | string | null
  maxDiskSizeGb?: number | string | null
  pricePerGbMonthInr?: number | string
  isDefaultForNewVms?: boolean
  isEnabled?: boolean
  notes?: string | null
  missingFromProxmox?: boolean
  lastSyncedAt?: string | null
  pricePerGbMonthly: number | string
}

type NodeTemplateRow = {
  id: string
  name: string
  osType?: string | null
  osFamily?: string | null
  osVersion?: string | null
  isActive: boolean
  isDefault: boolean
  reinstallEnabled?: boolean
  proxmoxVmid?: number | null
  proxmoxStatus?: string | null
  proxmoxStorage?: string | null
  storage?: string | null
  diskGb?: number | null
  size?: number | string | null
  cloudInitSupported?: boolean
  supportsCloudInit?: boolean
  proxmoxConfig?: Record<string, unknown> | null
  lastSyncedAt?: string | null
}

type TemplateDialogState =
  | { action: "clone"; template: NodeTemplateRow; newVmid: string; name: string; storage: string }
  | { action: "edit_metadata"; template: NodeTemplateRow; name: string; osFamily: string; osVersion: string; osType: string; storage: string; diskGb: string; cloudInitSupported: boolean; reinstallEnabled: boolean; isActive: boolean }
  | { action: "delete" | "verify_guest_agent" | "refresh_storage_mapping"; template: NodeTemplateRow; confirm: string }

type NodeBandwidthVm = {
  vpsInstanceId: string
  vmName: string
  vmid?: number | null
  customerName: string
  nodeId?: string | null
  rxBytes: number
  txBytes: number
  totalBytes: number
  remainingBytes: number
  rxRateBps: number
  txRateBps: number
  peakRateBps: number
  currentMbps: number
  throttled: boolean
  currentRateLimit: number | null
}

const STORAGE_CLASS_OPTIONS = [
  ["SSD", "SSD (Default) - ₹6/GB"],
  ["NVME_GEN4", "NVMe Gen4 - ₹8/GB"],
  ["NVME_GEN5", "NVMe Gen5 - ₹10/GB"],
] as const

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function secondsAgo(value: string | null, currentTime: number) {
  if (!value) return "never"
  const seconds = Math.max(0, Math.floor((currentTime - new Date(value).getTime()) / 1000))
  if (seconds < 3) return "just now"
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  return `${Math.floor(minutes / 60)}h ago`
}

function bytesToGbDecimal(value: unknown) {
  return bytesToDecimalGb(value)
}

function formatGbCapacity(value: unknown) {
  return formatBytesDecimal(value, { fallback: "-" })
}

function formatRate(value: unknown) {
  return formatByteRateDecimal(value, { fallback: "0 B" }).replace(/\/s$/, "")
}

function formatDuration(seconds: unknown) {
  let remaining = Math.max(0, Math.floor(Number(seconds || 0)))
  const days = Math.floor(remaining / 86400)
  remaining -= days * 86400
  const hours = Math.floor(remaining / 3600)
  remaining -= hours * 3600
  const minutes = Math.floor(remaining / 60)
  if (days) return `${days}d ${hours}h`
  if (hours) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

function finiteNumber(value: unknown, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function formatLoadAverage(metric: Partial<NodeMetricStream>, fallback = "-") {
  const load1 = Number(metric.load1)
  const load5 = Number(metric.load5)
  const load15 = Number(metric.load15)
  if (![load1, load5, load15].every(Number.isFinite)) return fallback
  return `${load1.toFixed(2)} / ${load5.toFixed(2)} / ${load15.toFixed(2)}`
}

function logLevelClass(level: string) {
  const normalized = level.toLowerCase()
  if (normalized === "error" || normalized === "critical") return "text-destructive"
  if (normalized === "warn" || normalized === "warning") return "text-amber-400"
  return "text-emerald-400"
}

function logIcon(log: LiveLog) {
  const text = `${log.source} ${log.event} ${log.message}`.toLowerCase()
  if (/network|ip|bridge/.test(text)) return "NET"
  if (/backup|restore|snapshot/.test(text)) return "BKP"
  if (/start|stop|reboot|shutdown|vm/.test(text)) return "VM"
  if (/disk|resize|storage/.test(text)) return "DSK"
  if (/task|queue/.test(text)) return "TSK"
  return "SYS"
}

function normalizeLogLevel(level: string) {
  const normalized = String(level || "info").toLowerCase()
  if (normalized === "warning") return "warn"
  if (normalized === "critical" || normalized === "fatal") return "critical"
  if (normalized === "error" || normalized === "warn" || normalized === "info") return normalized
  return "info"
}

function logSeverityDot(level: string) {
  const normalized = normalizeLogLevel(level)
  if (normalized === "critical") return "bg-red-500"
  if (normalized === "error") return "bg-destructive"
  if (normalized === "warn") return "bg-amber-500"
  return "bg-emerald-500"
}

function templateOsGroup(template: Pick<NodeTemplateRow, "name" | "osFamily" | "osType">) {
  const text = `${template.osFamily || ""} ${template.osType || ""} ${template.name || ""}`.toLowerCase()
  if (text.includes("windows")) return "Windows"
  if (text.includes("ubuntu")) return "Ubuntu"
  if (text.includes("debian")) return "Debian"
  if (text.includes("centos")) return "CentOS"
  if (text.includes("alma")) return "AlmaLinux"
  if (text.includes("rocky")) return "Rocky Linux"
  return template.osFamily || "Other"
}

function templateOsType(template: Pick<NodeTemplateRow, "name" | "osFamily" | "osVersion" | "osType">) {
  const raw = String(template.osType || "").toLowerCase()
  if (raw && raw !== "linux" && raw !== "windows") return raw
  const family = String(template.osFamily || templateOsGroup(template)).toLowerCase().replace(/\s+/g, "-")
  const version = String(template.osVersion || "").trim()
  return version ? `${family}-${version}` : raw || family
}

function templateDiskSize(template: Pick<NodeTemplateRow, "diskGb" | "size">) {
  if (template.diskGb !== null && template.diskGb !== undefined) return `${Number(template.diskGb).toLocaleString("en-IN")} GB`
  if (template.size !== null && template.size !== undefined && template.size !== "") return formatGbCapacity(template.size)
  return "-"
}

function templateStatus(template: Pick<NodeTemplateRow, "isActive" | "isDefault">) {
  if (template.isDefault) return "Default"
  return template.isActive === false ? "Disabled" : "Enabled"
}

/**
 * Guest-agent readiness for a template.
 *
 * Only one of these is a fact and one is a claim. `agentChannelEnabled` is what
 * the Proxmox config actually says. `cloudInitSupported` is the legacy column,
 * which recorded that the image shipped with Cloud-Init — useful history, but not
 * evidence that a guest agent is installed. The badge is deliberately split so an
 * admin is never told a template is ready to automate when the host can only
 * prove the channel is open.
 */
function templateGuestAgentBadge(template: Pick<NodeTemplateRow, "cloudInitSupported" | "supportsCloudInit" | "proxmoxConfig">) {
  const config = (template.proxmoxConfig || {}) as Record<string, unknown>
  const channelEnabled = Object.entries(config).some(([key, value]) => /^agent(\d+)?$/i.test(key) && Number(value) === 1)
  const verified = Boolean(template.cloudInitSupported ?? template.supportsCloudInit)

  if (channelEnabled && verified) return <Badge variant="default">Verified</Badge>
  if (channelEnabled) {
    return (
      <Badge variant="secondary" title="The guest agent channel is enabled on this template, but the image has not been verified to carry a working QEMU Guest Agent.">
        Unverified
      </Badge>
    )
  }
  return (
    <Badge variant="destructive" title="No guest agent channel is enabled on this template. Guest automation cannot configure servers cloned from it.">
      Missing
    </Badge>
  )
}

function formatDate(value: string | null) {
  if (!value) return "-"
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))
}

function storageTypeLabel(value?: string | null, custom?: string | null) {
  const type = String(value || "CUSTOM").toUpperCase()
  if (type === "CUSTOM") return custom || "Custom"
  if (type === "SSD") return "SSD (Default)"
  if (type === "NVME_GEN4") return "NVMe Gen4"
  if (type === "NVME_GEN5") return "NVMe Gen5"
  if (type === "NVME2") return "NVMe2"
  if (type === "NVME") return "NVMe"
  return type
}

function storageClassBadge(config: StorageConfig) {
  return storageTypeLabel(config.diskClass || config.storageType || config.type, config.customDiskLabel || config.customStorageLabel)
}

function storageEditPayload(config: StorageConfig) {
  return {
    displayName: config.displayName || config.storageId,
    diskClass: config.diskClass || config.storageType || "CUSTOM",
    customDiskLabel: config.customDiskLabel || config.customStorageLabel || "",
    pricePerGbMonthInr: config.pricePerGbMonthInr ?? config.pricePerGbMonthly ?? 0,
    minDiskSizeGb: config.minDiskSizeGb ?? config.minGb ?? 1,
    maxDiskSizeGb: config.maxDiskSizeGb ?? config.maxGb ?? null,
    isDefaultForNewVms: Boolean(config.isDefaultForNewVms ?? config.defaultForNewVm),
    defaultForVmDisk: Boolean(config.defaultForVmDisk ?? config.defaultDiskTarget ?? config.defaultForNewVm),
    defaultForTemplate: Boolean(config.defaultForTemplate ?? config.defaultTemplateTarget),
    defaultForBackup: Boolean(config.defaultForBackup ?? config.backupStorage),
    priority: Number(config.priority ?? config.storagePriority ?? config.sortOrder ?? 100),
    healthStatus: config.healthStatus || "unknown",
    supportedContent: Array.isArray(config.supportedContent) ? config.supportedContent : [],
    isCustomerSelectable: Boolean(config.isCustomerSelectable || config.allowNewPurchase),
    isUpgradeOnly: Boolean(config.isUpgradeOnly),
    isPremium: Boolean(config.isPremium || config.premium),
    premium: Boolean(config.isPremium || config.premium),
    isEnabled: Boolean(config.isEnabled ?? config.enabled),
    notes: config.notes || "",
  }
}

function mergeLiveMetrics(current: NodeDetail, live: LiveMetrics): NodeDetail {
  return {
    ...current,
    status: live.status,
    checkedAt: live.refreshedAt,
    error: undefined,
    health: live.health,
    errors: live.errors || current.errors || {},
    cpu: {
      ...current.cpu,
      usagePercent: live.cpuUsage,
      totalCores: live.cpuCores,
      loadAverage: live.loadAverage,
    },
    memory: {
      ...current.memory,
      used: live.memoryUsed,
      total: live.memoryTotal,
      usedBytes: live.memoryUsedBytes,
      totalBytes: live.memoryTotalBytes,
      usagePercent: live.memoryUsage,
    },
    disk: {
      ...current.disk,
      used: live.diskUsed,
      total: live.diskTotal,
      usedBytes: live.diskUsedBytes,
      totalBytes: live.diskTotalBytes,
      usagePercent: live.diskUsage,
    },
    network: {
      inbound: live.networkIn,
      outbound: live.networkOut,
      inboundBytes: live.networkInBytes,
      outboundBytes: live.networkOutBytes,
    },
    uptime: {
      readable: live.uptime,
      seconds: live.uptimeSeconds,
    },
    loadAverage: live.loadAverage,
    vmSummary: {
      running: live.runningInstances,
      stopped: live.stoppedInstances,
      templates: live.templates,
      failedUnknown: live.failedUnknown,
      total: live.totalGuests,
    },
  }
}

export default function ComputeNodeDetailPage() {
  const params = useParams()
  const id = firstParam(params?.id)
  const [node, setNode] = useState<NodeDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [liveEnabled, setLiveEnabled] = useState(true)
  const [liveUpdating, setLiveUpdating] = useState(false)
  const [liveFailures, setLiveFailures] = useState(0)
  const [liveWarning, setLiveWarning] = useState<string | null>(null)
  const [lastLiveAt, setLastLiveAt] = useState<string | null>(null)
  const [samples, setSamples] = useState<LiveSample[]>([])
  const [liveLogs, setLiveLogs] = useState<LiveLog[]>([])
  const [logFilter, setLogFilter] = useState("all")
  const [logAutoScroll, setLogAutoScroll] = useState(true)
  const [expandedLogIds, setExpandedLogIds] = useState<Set<string>>(() => new Set())
  const [latestMetric, setLatestMetric] = useState<NodeMetricStream | null>(null)
  const [storageConfigs, setStorageConfigs] = useState<StorageConfig[]>([])
  const [storageDraft, setStorageDraft] = useState<StorageConfig | null>(null)
  const [storageSaving, setStorageSaving] = useState(false)
  const [storageFocus, setStorageFocus] = useState(false)
  const [nodeTemplates, setNodeTemplates] = useState<NodeTemplateRow[]>([])
  const [templateActionId, setTemplateActionId] = useState<string | null>(null)
  const [templateDialog, setTemplateDialog] = useState<TemplateDialogState | null>(null)
  const [bandwidthVms, setBandwidthVms] = useState<NodeBandwidthVm[]>([])
  const [bandwidthActionId, setBandwidthActionId] = useState<string | null>(null)
  const [isoUploading, setIsoUploading] = useState(false)
  const [isoStorage, setIsoStorage] = useState("")
  const [now, setNow] = useState(0)
  const [serverNow, setServerNow] = useState<Date | null>(null)
  const [vmSearch, setVmSearch] = useState("")
  const [vmPage, setVmPage] = useState(1)
  const timeoutRef = useRef<number | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const inFlightRef = useRef(false)
  const liveFailuresRef = useRef(0)
  const logsEndRef = useRef<HTMLDivElement | null>(null)

  async function load(options: { refresh?: boolean } = {}) {
    if (!id) return
    if (options.refresh) setRefreshing(true)
    else setLoading(true)
    try {
      const res = await fetch(options.refresh ? `/api/admin/compute-nodes/${id}/refresh` : `/api/admin/compute-nodes/${id}`, {
        method: options.refresh ? "POST" : "GET",
        cache: "no-store",
      })
      const data = await readJsonResponse<any>(res) || {}
      if (!res.ok) throw new Error(data.error || "Failed to load node")
      const incoming = data.node as NodeDetail
      if (incoming?.status === "failed" && node && liveFailuresRef.current < 2) {
        const nextFailures = liveFailuresRef.current + 1
        liveFailuresRef.current = nextFailures
        setLiveFailures(nextFailures)
        setLiveWarning(`${incoming.error || "Refresh failed"}; showing last known metrics.`)
        setNode({
          ...node,
          status: "warning",
          health: { status: "warning", critical: false },
          checkedAt: incoming.checkedAt || node.checkedAt,
          error: undefined,
          errors: { ...(node.errors || {}), node: incoming.error || "Latest refresh failed" },
        })
      } else {
        liveFailuresRef.current = incoming?.status === "failed" ? 3 : 0
        setNode(incoming)
        setLiveFailures(incoming?.status === "failed" ? 3 : 0)
        setLiveWarning(null)
      }
      setLastLiveAt(incoming?.checkedAt || new Date().toISOString())
      void loadStorageConfigs()
      void loadInventory()
      void loadNodeTemplates()
      void loadNodeBandwidth()
      if (options.refresh) toast.success("Node refreshed")
    } catch (error: any) {
      toast.error(error.message || "Failed to load node")
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  async function loadStorageConfigs() {
    if (!id) return
    if (storageDraft || storageFocus) return
    const res = await fetch(`/api/admin/compute-nodes/${id}/storage-pools`, { cache: "no-store" })
    const data = await readJsonResponse<any>(res) || {}
    if (res.ok) setStorageConfigs(data.configs || [])
  }

  async function loadInventory() {
    if (!id) return
    const res = await fetch(`/api/admin/compute-nodes/${id}/inventory`, { cache: "no-store" })
    const data = await readJsonResponse<any>(res) || {}
    if (!res.ok || !data.success) return
    setNode((current) => current ? {
      ...current,
      templates: data.templates || [],
      isos: data.isos || [],
      tasks: data.tasks || [],
      events: data.events || [],
      errors: { ...(current.errors || {}), ...(data.errors || {}) },
    } : current)
  }

  async function loadNodeTemplates() {
    if (!id) return
    const res = await fetch(`/api/admin/compute-nodes/${id}/templates`, { cache: "no-store" })
    const data = await readJsonResponse<any>(res) || {}
    if (res.ok && data.success) setNodeTemplates(data.templates || [])
  }

  async function templateAction(template: NodeTemplateRow, action: "enable" | "disable" | "set_default" | "delete" | "sync" | "clone" | "edit_metadata" | "verify_guest_agent" | "refresh_storage_mapping" | "open_proxmox", payload: Record<string, unknown> = {}) {
    if (!id) return
    setTemplateActionId(`${template.id}:${action}`)
    try {
      const res = await fetch(`/api/admin/compute-nodes/${id}/templates/${template.id}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...payload }),
      })
      const data = await readJsonResponse<any>(res) || {}
      if (!res.ok || !data.success) throw new Error(data.error || "Template action failed")
      if (action === "open_proxmox" && data.url) {
        window.open(String(data.url), "_blank", "noopener,noreferrer")
      }
      toast.success(action === "set_default" ? "Default template updated" : action === "clone" ? "Template clone started" : "Template updated")
      await loadNodeTemplates()
      await loadInventory()
    } catch (error: any) {
      toast.error(error.message || "Template action failed")
    } finally {
      setTemplateActionId(null)
    }
  }

  async function submitTemplateDialog() {
    if (!templateDialog) return
    const dialog = templateDialog
    if (dialog.action === "clone") {
      if (!dialog.newVmid.trim() || !dialog.name.trim()) return toast.error("Clone requires a new VMID and template name")
      setTemplateDialog(null)
      await templateAction(dialog.template, "clone", { newVmid: Number(dialog.newVmid), name: dialog.name, storage: dialog.storage || undefined })
      return
    }
    if (dialog.action === "edit_metadata") {
      setTemplateDialog(null)
      await templateAction(dialog.template, "edit_metadata", {
        name: dialog.name,
        osFamily: dialog.osFamily,
        osVersion: dialog.osVersion,
        osType: dialog.osType,
        storage: dialog.storage,
        diskGb: dialog.diskGb ? Number(dialog.diskGb) : undefined,
        cloudInitSupported: dialog.cloudInitSupported,
        reinstallEnabled: dialog.reinstallEnabled,
        isActive: dialog.isActive,
      })
      return
    }
    const expected = dialog.action === "delete" ? "delete" : dialog.action === "verify_guest_agent" ? "verify" : "refresh"
    if (dialog.confirm.trim().toLowerCase() !== expected) return toast.error(`Type ${expected} to confirm`)
    setTemplateDialog(null)
    await templateAction(dialog.template, dialog.action, { confirm: expected })
  }

  function openTemplateDialog(template: NodeTemplateRow, action: TemplateDialogState["action"]) {
    if (action === "clone") {
      setTemplateDialog({ action, template, newVmid: "", name: `${template.name}-copy`, storage: template.proxmoxStorage || template.storage || "" })
    } else if (action === "edit_metadata") {
      setTemplateDialog({
        action,
        template,
        name: template.name,
        osFamily: template.osFamily || "",
        osVersion: template.osVersion || "",
        osType: template.osType || "",
        storage: template.proxmoxStorage || template.storage || "",
        diskGb: template.diskGb == null ? "" : String(template.diskGb),
        cloudInitSupported: Boolean(template.cloudInitSupported ?? template.supportsCloudInit),
        reinstallEnabled: template.reinstallEnabled !== false,
        isActive: template.isActive !== false,
      })
    } else {
      setTemplateDialog({ action, template, confirm: "" })
    }
  }

  async function syncNodeTemplates() {
    if (!id) return
    setRefreshing(true)
    try {
      const res = await fetch(`/api/admin/compute-nodes/${id}/templates`, { method: "POST", cache: "no-store" })
      const data = await readJsonResponse<any>(res) || {}
      if (!res.ok || !data.success) throw new Error(data.error || "Template sync failed")
      setNodeTemplates(data.templates || [])
      toast.success("Templates synced")
      await loadInventory()
    } catch (error: any) {
      toast.error(error.message || "Template sync failed")
    } finally {
      setRefreshing(false)
    }
  }

  async function loadNodeBandwidth() {
    if (!id) return
    const res = await fetch("/api/admin/bandwidth", { cache: "no-store" })
    const data = await readJsonResponse<any>(res) || {}
    if (res.ok && data.success) {
      setBandwidthVms((data.vms || []).filter((row: NodeBandwidthVm) => row.nodeId === id))
    }
  }

  async function bandwidthAction(vpsId: string, action: "limit" | "restore") {
    if (!id) return
    setBandwidthActionId(`${vpsId}:${action}`)
    try {
      const res = await fetch(`/api/admin/compute-nodes/${id}/bandwidth/${vpsId}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "limit" ? { throttleRateMbps: 0.5 } : {}),
      })
      const data = await readJsonResponse<any>(res) || {}
      if (!res.ok || !data.success) throw new Error(data.error || "Bandwidth action failed")
      toast.success(action === "limit" ? "0.5 Mbps limit applied and verified" : "Bandwidth limit restored")
      await loadNodeBandwidth()
    } catch (error: any) {
      toast.error(error.message || "Bandwidth action failed")
    } finally {
      setBandwidthActionId(null)
    }
  }

  async function updateStorageConfig(config: StorageConfig, patch: Partial<StorageConfig>) {
    if (!id) return
    const res = await fetch(`/api/admin/storage-pools/${config.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(storageEditPayload({ ...config, ...patch })),
    })
    const data = await readJsonResponse<any>(res) || {}
    if (!res.ok) return toast.error(data.error || "Failed to update storage pool")
    toast.success("Storage pool updated")
    await loadStorageConfigs()
  }

  async function storageAction(config: StorageConfig, action: "set-default" | "enable" | "disable") {
    const res = await fetch(`/api/admin/storage-pools/${config.id}/${action}`, { method: "POST" })
    const data = await readJsonResponse<any>(res) || {}
    if (!res.ok) return toast.error(data.error || "Storage action failed")
    toast.success(action === "set-default" ? "Default storage pool updated" : "Storage pool updated")
    await loadStorageConfigs()
  }

  async function syncStoragePools() {
    if (!id) return
    setRefreshing(true)
    try {
      const res = await fetch(`/api/admin/compute-nodes/${id}/storage-pools`, { method: "POST", cache: "no-store" })
      const data = await readJsonResponse<any>(res) || {}
      if (!res.ok) throw new Error(data.error || "Storage sync failed")
      setStorageConfigs(data.configs || [])
      toast.success("Storage pools synced")
    } catch (error: any) {
      toast.error(error.message || "Storage sync failed")
    } finally {
      setRefreshing(false)
    }
  }

  async function saveStorageDraft() {
    if (!storageDraft) return
    setStorageSaving(true)
    try {
      const res = await fetch(`/api/admin/storage-pools/${storageDraft.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(storageEditPayload(storageDraft)),
      })
      const data = await readJsonResponse<any>(res) || {}
      if (!res.ok) throw new Error(data.error || "Failed to save storage pool")
      toast.success("Storage pool saved")
      setStorageDraft(null)
      await loadStorageConfigs()
    } catch (error: any) {
      toast.error(error.message || "Failed to save storage pool")
    } finally {
      setStorageSaving(false)
    }
  }

  async function uploadIso(file?: File | null) {
    if (!id || !file) return
    const storage = isoStorage || storageRows.find((pool) => pool.enabled)?.storageId || ""
    if (!storage) return toast.error("Select storage before uploading an ISO")
    setIsoUploading(true)
    try {
      const form = new FormData()
      form.set("storage", storage)
      form.set("file", file)
      const res = await fetch(`/api/admin/compute-nodes/${id}/iso-upload`, { method: "POST", body: form })
      const data = await readJsonResponse<any>(res) || {}
      if (!res.ok || !data.success) throw new Error(data.error || "ISO upload failed")
      toast.success("ISO upload started")
      await loadInventory()
    } catch (error: any) {
      toast.error(error.message || "ISO upload failed")
    } finally {
      setIsoUploading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    setNow(Date.now())
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const base = node?.serverTime?.time ? new Date(node.serverTime.time).getTime() : Date.now()
    const startedAt = Date.now()
    setServerNow(new Date(base))
    const timer = window.setInterval(() => {
      setServerNow(new Date(base + (Date.now() - startedAt)))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [node?.serverTime?.time])

  useEffect(() => {
    if (!id || !node?.node?.id || !liveEnabled || storageDraft || storageFocus) return

    const events = new EventSource(`/api/admin/compute-nodes/${id}/live/stream`)
    events.addEventListener("metric", (event) => {
      const parsed = JSON.parse((event as MessageEvent).data) as Partial<NodeMetricStream>
      const metric: NodeMetricStream = {
        cpuUsage: finiteNumber(parsed.cpuUsage),
        ramUsage: finiteNumber(parsed.ramUsage),
        diskUsage: finiteNumber(parsed.diskUsage),
        diskRead: finiteNumber(parsed.diskRead),
        diskWrite: finiteNumber(parsed.diskWrite),
        networkIn: finiteNumber(parsed.networkIn),
        networkOut: finiteNumber(parsed.networkOut),
        load1: finiteNumber(parsed.load1, NaN),
        load5: finiteNumber(parsed.load5, NaN),
        load15: finiteNumber(parsed.load15, NaN),
        uptime: finiteNumber(parsed.uptime),
        runningVms: finiteNumber(parsed.runningVms),
        stoppedVms: finiteNumber(parsed.stoppedVms),
        storageUsed: finiteNumber(parsed.storageUsed),
        storageFree: finiteNumber(parsed.storageFree),
        temperature: parsed.temperature == null ? null : finiteNumber(parsed.temperature, NaN),
        latencyMs: parsed.latencyMs == null ? null : finiteNumber(parsed.latencyMs, NaN),
        activeTasks: finiteNumber(parsed.activeTasks),
        taskQueue: finiteNumber(parsed.taskQueue),
        health: String(parsed.health || "connected"),
        recordedAt: String(parsed.recordedAt || new Date().toISOString()),
      }
      setLatestMetric(metric)
      setLastLiveAt(metric.recordedAt)
      setLiveFailures(0)
      setLiveWarning(null)
      setNode((current) => current ? {
        ...current,
        status: metric.health === "failed" ? "failed" : metric.health === "warning" ? "warning" : "connected",
        checkedAt: metric.recordedAt,
        health: { status: metric.health, critical: metric.health === "failed" },
        cpu: { ...current.cpu, usagePercent: metric.cpuUsage, loadAverage: formatLoadAverage(metric, current.cpu.loadAverage) },
        memory: { ...current.memory, usagePercent: metric.ramUsage },
        disk: { ...current.disk, usagePercent: metric.diskUsage },
        network: { ...current.network, inboundBytes: metric.networkIn, outboundBytes: metric.networkOut, inbound: `${formatRate(metric.networkIn)}/s`, outbound: `${formatRate(metric.networkOut)}/s` },
        uptime: { ...current.uptime, seconds: metric.uptime, readable: formatDuration(metric.uptime) },
        loadAverage: formatLoadAverage(metric, current.loadAverage),
        vmSummary: { ...current.vmSummary, running: metric.runningVms, stopped: metric.stoppedVms, total: metric.runningVms + metric.stoppedVms + current.vmSummary.templates },
      } : current)
      setSamples((current) => [
        ...current.slice(-119),
        {
          at: Date.now(),
          cpu: metric.cpuUsage,
          memory: metric.ramUsage,
          disk: metric.diskUsage,
          networkIn: metric.networkIn,
          networkOut: metric.networkOut,
        },
      ])
    })
    events.onerror = () => {
      setLiveFailures((value) => value + 1)
      setLiveWarning("Live telemetry stream disconnected; retrying automatically.")
    }
    return () => events.close()
  }, [id, node?.node?.id, liveEnabled, storageDraft, storageFocus])

  useEffect(() => {
    if (!id || !node?.node?.id || !liveEnabled) return
    const events = new EventSource(`/api/admin/compute-nodes/${id}/logs/stream`)
    events.addEventListener("logs", (event) => {
      const rows = JSON.parse((event as MessageEvent).data) as LiveLog[]
      setLiveLogs((current) => {
        const byId = new Map(current.map((row) => [row.id, row]))
        for (const row of rows) {
          if (!row?.id) continue
          byId.set(row.id, { ...row, level: normalizeLogLevel(row.level) })
        }
        return Array.from(byId.values())
          .sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime())
          .slice(-350)
      })
    })
    return () => events.close()
  }, [id, node?.node?.id, liveEnabled])

  useEffect(() => {
    if (logAutoScroll) logsEndRef.current?.scrollIntoView({ block: "end" })
  }, [liveLogs.length, logFilter, logAutoScroll])

  useEffect(() => {
    if (!id || !node?.node?.id || !liveEnabled || storageDraft || storageFocus) return
    if ("EventSource" in window) return

    let stopped = false
    let consecutiveFailures = liveFailuresRef.current

    const clearLiveTimeout = () => {
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }

    const schedule = () => {
      if (stopped || document.visibilityState === "hidden") return
      clearLiveTimeout()
          timeoutRef.current = window.setTimeout(() => void poll(), 30_000)
    }

    const poll = async () => {
      if (stopped || inFlightRef.current) return
      if (document.visibilityState === "hidden") {
        clearLiveTimeout()
        return
      }
      const controller = new AbortController()
      abortRef.current = controller
      inFlightRef.current = true
      setLiveUpdating(true)

      try {
        const res = await fetch(`/api/admin/compute-nodes/${id}/live`, {
          cache: "no-store",
          signal: controller.signal,
        })
        const data = await readJsonResponse<any>(res) || {}
        if (!res.ok || !data.success) throw new Error(data.error || "Live update failed")
        const live = data as LiveMetrics & { success: boolean }
        consecutiveFailures = 0
        liveFailuresRef.current = 0
        setLiveFailures(0)
        setLiveWarning(null)
        setLastLiveAt(live.refreshedAt)
        setNode((current) => current ? mergeLiveMetrics(current, live) : current)
        setSamples((current) => [
          ...current.slice(-59),
          {
            at: Date.now(),
            cpu: live.cpuUsage,
            memory: live.memoryUsage,
            disk: live.diskUsage,
            networkIn: live.networkInBytes,
            networkOut: live.networkOutBytes,
          },
        ])
      } catch (error: any) {
        if (error?.name !== "AbortError") {
          consecutiveFailures += 1
          liveFailuresRef.current = consecutiveFailures
          setLiveFailures(consecutiveFailures)
          const message = error.message || "Live update failed"
          setLiveWarning(consecutiveFailures >= 3 ? "Live update disconnected" : `${message}; showing last known metrics.`)
          if (consecutiveFailures >= 3) {
            setNode((current) => current ? {
              ...current,
              status: "failed",
              health: { status: "failed", critical: true },
              error: message,
            } : current)
          }
        }
      } finally {
        if (!stopped && abortRef.current === controller) {
          abortRef.current = null
          inFlightRef.current = false
          setLiveUpdating(false)
          schedule()
        } else if (abortRef.current === controller) {
          abortRef.current = null
          inFlightRef.current = false
        }
      }
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        clearLiveTimeout()
        void poll()
      } else {
        clearLiveTimeout()
      }
    }

    document.addEventListener("visibilitychange", onVisibilityChange)
    void poll()

    return () => {
      stopped = true
      document.removeEventListener("visibilitychange", onVisibilityChange)
      clearLiveTimeout()
      abortRef.current?.abort()
      abortRef.current = null
      inFlightRef.current = false
    }
  }, [id, node?.node?.id, liveEnabled, storageDraft, storageFocus])

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-12 w-80" />
        <div className="grid gap-4 md:grid-cols-3"><Skeleton className="h-36" /><Skeleton className="h-36" /><Skeleton className="h-36" /></div>
        <Skeleton className="h-96" />
      </div>
    )
  }

  if (!node) {
    return (
      <Card id="vm-capacity" className="glass border-border/40">
        <CardContent className="py-12 text-center text-muted-foreground">Compute node details are unavailable.</CardContent>
      </Card>
    )
  }

  const currentNow = now || new Date(node.checkedAt || Date.now()).getTime()
  const refreshedLabel = secondsAgo(lastLiveAt || node.checkedAt, currentNow)
  const liveState = !liveEnabled ? "paused" : liveFailures >= 3 ? "offline" : liveFailures > 0 ? "reconnecting" : "connected"
  const storageRows = storageConfigs.length ? storageConfigs : node.storage.map((pool, index) => ({
    id: pool.name,
    storageId: pool.name,
    displayName: pool.name,
    type: pool.type,
    storageType: pool.type,
    totalBytes: pool.totalBytes,
    usedBytes: pool.usedBytes,
    freeBytes: pool.freeBytes,
    availableBytes: pool.freeBytes,
    enabled: pool.enabled !== false && pool.active !== false,
    defaultForNewVm: index === 0,
    defaultForVmDisk: index === 0,
    isDefaultForNewVms: index === 0,
    defaultForTemplate: /vztmpl|images|iso/i.test(String((pool as any).content || "")),
    defaultForBackup: /backup/i.test(String((pool as any).content || "")),
    premium: false,
    allowNewPurchase: false,
    allowUpgrade: false,
    pricePerGbMonthly: 0,
    priority: index,
    healthStatus: pool.enabled === false || pool.active === false ? "disabled" : "healthy",
    supportedContent: String((pool as any).content || "").split(",").map((item) => item.trim()).filter(Boolean),
  } as StorageConfig))
  const totalStorageBytes = storageRows.reduce((sum, pool) => sum + Number(pool.totalBytes || 0), 0)
  const usedStorageBytes = storageRows.reduce((sum, pool) => sum + Number(pool.usedBytes || 0), 0)
  const availableStorageBytes = storageRows.reduce((sum, pool) => sum + Number(pool.availableBytes || pool.freeBytes || 0), 0)
  const defaultPool = storageRows.find((pool) => pool.defaultForNewVm)
  const premiumCount = storageRows.filter((pool) => pool.isPremium || pool.premium).length
  const vmGuests = node.guests.filter((guest) => !guest.template)
  const filteredVmGuests = (() => {
    const query = vmSearch.trim().toLowerCase()
    if (!query) return vmGuests
    return vmGuests.filter((guest) => [
      guest.vmid,
      guest.name,
      guest.status,
      guest.ipAddress,
      guest.os,
    ].some((value) => String(value || "").toLowerCase().includes(query)))
  })()
  const vmPageSize = 10
  const vmPages = Math.max(1, Math.ceil(filteredVmGuests.length / vmPageSize))
  const pagedVmGuests = filteredVmGuests.slice((Math.min(vmPage, vmPages) - 1) * vmPageSize, Math.min(vmPage, vmPages) * vmPageSize)
  const serverTimeLabel = serverNow ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "medium", timeZone: "Asia/Kolkata" }).format(serverNow) : "-"
  const timezoneLabel = "India Standard Time (IST)"
  const filteredLiveLogs = liveLogs.filter((log) => {
    const filter = logFilter.toLowerCase()
    const level = normalizeLogLevel(log.level)
    if (filter === "all") return true
    if (filter === "warning") return level === "warn"
    if (["error", "critical"].includes(filter)) return level === filter
    return log.source.toLowerCase() === filter
  })
  const templateRows = (nodeTemplates.length ? nodeTemplates : (node.templates || []) as any[]).slice(0, 200)

  async function copyText(value?: string | null, label = "Copied") {
    if (!value) return toast.error("Nothing to copy")
    await navigator.clipboard.writeText(value)
    toast.success(label)
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
            <Link href="/admin/compute-nodes"><ArrowLeft className="mr-2 h-4 w-4" />Back to nodes</Link>
          </Button>
          <h1 className="text-2xl font-semibold">{node.node.name}</h1>
          <p className="text-sm text-muted-foreground">{node.node.host} · {node.node.nodeName} · {node.node.location || "No location"}</p>
          <p className="text-xs text-muted-foreground">
            Last refreshed {refreshedLabel}{liveUpdating ? " · Updating..." : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <LiveBadge state={liveState} />
          <StatusBadge status={node.status} critical={node.health.critical} />
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setLiveEnabled((value) => {
                if (value) {
                  abortRef.current?.abort()
                  setLiveUpdating(false)
                }
                return !value
              })
              setLiveWarning(null)
            }}
            className="gap-2"
          >
            {liveEnabled ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            {liveEnabled ? "Pause" : "Resume"}
          </Button>
          <NodeDetailActions
            host={node.node.host}
            refreshing={refreshing}
            onRefresh={() => load({ refresh: true })}
            onSyncTemplates={syncNodeTemplates}
            onUploadIso={() => document.getElementById("upload-iso-control")?.click()}
          />
        </div>
      </div>

      {node.error ? <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{node.error}</div> : null}
      {liveWarning ? <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">{liveWarning}</div> : null}
      {Object.keys(node.errors || {}).length ? <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">{Object.entries(node.errors).map(([key, value]) => `${key}: ${value}`).join(" · ")}</div> : null}

      <div className="flex flex-wrap gap-3 rounded-md border border-border/40 bg-background/60 px-3 py-2 text-xs text-muted-foreground">
        {[
          ["Live", "live-metrics"],
          ["Network", "network-usage"],
          ["Activity", "logs"],
          ["Templates", "templates"],
          ["ISOs", "isos"],
          ["VMs", "vm-capacity"],
        ].map(([label, target]) => (
          <button key={target} type="button" className="hover:text-foreground" onClick={() => document.getElementById(target)?.scrollIntoView({ behavior: "smooth", block: "start" })}>{label}</button>
        ))}
      </div>

      <div id="live-metrics" className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={Cpu} title="CPU Usage" value={`${node.cpu.usagePercent.toFixed(1)}%`} detail={`${node.cpu.totalSockets || 0} sockets · ${node.cpu.totalCores || 0} cores`} progress={node.cpu.usagePercent} trend={samples.map((sample) => sample.cpu)} />
        <MetricCard icon={MemoryStick} title="Memory Usage" value={`${node.memory.usagePercent.toFixed(1)}%`} detail={`${node.memory.used} / ${node.memory.total}`} progress={node.memory.usagePercent} trend={samples.map((sample) => sample.memory)} />
        <InfoCard icon={Server} title="Load" value={node.loadAverage} detail={node.uptime.readable} />
        <MetricCard icon={ShieldCheck} title="Node Health" value={node.status} detail={node.health.critical ? "Critical threshold reached" : "Thresholds normal"} />
      </div>

      <div id="network-usage" className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <InfoCard icon={Activity} title="Running Instances" value={node.vmSummary.running} detail={`${node.vmSummary.stopped} stopped · ${node.vmSummary.failedUnknown} unknown`} />
        <InfoCard icon={Database} title="Templates" value={node.vmSummary.templates} detail={`${node.vmSummary.total} total guests`} />
        <InfoCard icon={Network} title="Network" value={node.nodeBandwidth?.total || node.network.inbound} detail={`${node.nodeBandwidth?.peakRate || node.network.outbound} peak`} trend={samples.map((sample) => sample.networkIn + sample.networkOut)} />
        <InfoCard icon={Server} title="Uptime" value={node.uptime.readable} detail={`Load ${node.loadAverage}`} />
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <InfoCard icon={Network} title="Total Bandwidth" value={node.nodeBandwidth?.total || "0 GB"} detail={`In ${node.nodeBandwidth?.inbound || "0 GB"} · Out ${node.nodeBandwidth?.outbound || "0 GB"}`} />
        <InfoCard icon={Activity} title="Active Provisioning" value={node.activeProvisioningJobs?.length || 0} detail={(node.activeProvisioningJobs || [])[0]?.displayStatus || "No active jobs"} />
        <InfoCard icon={Server} title="Provision Capacity" value={node.provisionCapacity?.priority || "blocked"} detail={node.provisionCapacity?.remainingVmCapacity == null ? "Capacity: auto" : `${node.provisionCapacity.remainingVmCapacity} left`} />
      </div>

      <Card id="node-statistics" className="glass border-border/40">
        <CardHeader>
          <CardTitle>NOC Live Telemetry</CardTitle>
          <CardDescription>One-second persisted stream from the node telemetry worker.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Detail label="Last sync" value={latestMetric?.recordedAt ? secondsAgo(latestMetric.recordedAt, currentNow) : refreshedLabel} />
          <Detail label="Node latency" value={latestMetric?.latencyMs == null ? "-" : `${latestMetric.latencyMs} ms`} />
          <Detail label="Task queue" value={`${latestMetric?.taskQueue ?? 0} queued`} />
          <Detail label="Active tasks" value={`${latestMetric?.activeTasks ?? 0}`} />
          <Detail label="Temperature" value={latestMetric?.temperature == null ? "N/A" : `${latestMetric.temperature.toFixed(1)} C`} />
        </CardContent>
      </Card>

      <Card id="bandwidth-controls" className="glass border-border/40">
        <CardHeader>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <CardTitle>Node Bandwidth Controls</CardTitle>
              <CardDescription>Apply verified Proxmox NIC limits, restore full speed, and review live transfer for VMs on this node.</CardDescription>
            </div>
            <Button type="button" variant="outline" onClick={() => void loadNodeBandwidth()} className="gap-2"><RefreshCw className="h-4 w-4" />Refresh bandwidth</Button>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>VM</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Transfer</TableHead>
                <TableHead>Remaining</TableHead>
                <TableHead>Current</TableHead>
                <TableHead>Peak</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bandwidthVms.length ? bandwidthVms.map((row) => {
                const currentRate = Number(row.rxRateBps || 0) + Number(row.txRateBps || 0)
                return (
                  <TableRow key={row.vpsInstanceId}>
                    <TableCell><div className="font-medium">{row.vmName}</div><div className="text-xs text-muted-foreground">VMID {row.vmid || "-"}</div></TableCell>
                    <TableCell>{row.customerName}</TableCell>
                    <TableCell>{formatGbCapacity(row.totalBytes)}<div className="text-xs text-muted-foreground">RX {formatGbCapacity(row.rxBytes)} / TX {formatGbCapacity(row.txBytes)}</div></TableCell>
                    <TableCell>{formatGbCapacity(row.remainingBytes)}</TableCell>
                    <TableCell>{((currentRate * 8) / 1_000_000).toFixed(3)} Mbps<div className="text-xs text-muted-foreground">{((currentRate * 8) / 1_000).toFixed(1)} Kbps</div></TableCell>
                    <TableCell>{formatRate(row.peakRateBps)}</TableCell>
                    <TableCell><Badge variant={row.throttled ? "destructive" : "outline"}>{row.throttled ? `Throttled ${row.currentRateLimit ?? ""}` : "Full speed"}</Badge></TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button type="button" size="sm" variant="outline" disabled={bandwidthActionId === `${row.vpsInstanceId}:limit`} onClick={() => void bandwidthAction(row.vpsInstanceId, "limit")}>Limit to 0.5 Mbps</Button>
                        <Button type="button" size="sm" variant="outline" disabled={bandwidthActionId === `${row.vpsInstanceId}:restore`} onClick={() => void bandwidthAction(row.vpsInstanceId, "restore")}>Restore Full Speed</Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              }) : <TableRow><TableCell colSpan={8} className="py-8 text-center text-muted-foreground">No bandwidth rollups for VMs on this node yet.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card id="logs" className="glass border-border/40">
        <CardHeader className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Unified Live Activity Feed</CardTitle>
            <CardDescription>Provisioning, VM actions, bandwidth, network, Proxmox tasks, API failures, template sync, and admin actions.</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {["all", "proxmox", "provisioning", "network", "panel", "warning", "error", "critical"].map((level) => (
              <Button key={level} type="button" size="sm" variant={logFilter === level ? "default" : "outline"} onClick={() => setLogFilter(level)} className="h-8 capitalize">{level}</Button>
            ))}
            <label className="flex h-8 items-center gap-2 rounded-md border border-border/40 px-2 text-xs">
              <input type="checkbox" checked={logAutoScroll} onChange={(event) => setLogAutoScroll(event.target.checked)} />
              Auto-scroll
            </label>
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <div className="h-80 overflow-y-auto rounded-md border border-border/30 bg-background/40 font-mono text-xs">
            {filteredLiveLogs.length ? filteredLiveLogs.map((log) => (
              <div key={log.id} className="border-b border-border/20 px-2 py-1.5 last:border-0">
                <div className="grid items-center gap-2 md:grid-cols-[12px_88px_78px_116px_1fr_64px]">
                  <span className={`h-2 w-2 rounded-full ${logSeverityDot(log.level)}`} />
                  <span className="text-muted-foreground">[{new Date(log.createdAt).toLocaleTimeString("en-IN", { hour12: false })}]</span>
                  <span className={logLevelClass(log.level)}>{normalizeLogLevel(log.level)}</span>
                  <span className="truncate text-muted-foreground">{logIcon(log)} {log.source}</span>
                  <button type="button" className="min-w-0 truncate text-left" onClick={() => setExpandedLogIds((current) => {
                    const next = new Set(current)
                    if (next.has(log.id)) next.delete(log.id)
                    else next.add(log.id)
                    return next
                  })}>{log.message}</button>
                  <Button type="button" size="icon" variant="ghost" className="h-6 w-6 justify-self-end" onClick={() => copyText(`${log.createdAt} ${log.level} ${log.source} ${log.message}`, "Log line copied")}><Copy className="h-3.5 w-3.5" /></Button>
                </div>
                {expandedLogIds.has(log.id) ? (
                  <pre className="mt-2 max-h-48 overflow-auto rounded border border-border/30 bg-background/70 p-2 text-[11px] text-muted-foreground">{JSON.stringify({ event: log.event, metadata: log.metadata || {} }, null, 2)}</pre>
                ) : null}
              </div>
            )) : <div className="py-20 text-center text-muted-foreground">Waiting for live events...</div>}
            <div ref={logsEndRef} />
          </div>
        </CardContent>
      </Card>

      <Card className="glass border-border/40">
        <CardHeader>
          <CardTitle>Node Overview</CardTitle>
          <CardDescription>Version, kernel, server clock, and hardware summary.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <Detail label="Proxmox version" value={node.version.proxmox || "-"} />
          <Detail label="Kernel" value={node.version.kernel || "-"} />
          <Detail label="Server time" value={serverTimeLabel} />
          <Detail label="Time zone" value={timezoneLabel} />
          <Detail label="CPU model" value={node.cpu.model || "-"} />
          <Detail label="Detected CPU sockets" value={node.cpu.totalSockets ? String(node.cpu.totalSockets) : "-"} />
          <Detail label="Default VM topology" value={node.cpu.totalSockets === 2 ? "2 sockets when vCPU is divisible by 2" : "1 socket fallback"} />
          <Detail label="Load average" value={node.cpu.loadAverage || "-"} />
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,0.7fr)]">
        <Card id="templates" className="glass border-border/40">
          <CardHeader className="px-4 py-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <CardTitle>Template Management</CardTitle>
                <CardDescription>Node-scoped Proxmox templates with compact metadata and one options menu per row.</CardDescription>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => void syncNodeTemplates()} disabled={refreshing} className="gap-2">
                <RefreshCw className="h-4 w-4" />Sync templates
              </Button>
            </div>
          </CardHeader>
          <CardContent className="overflow-x-auto px-4 pb-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>OS Group</TableHead>
                  <TableHead>OS Type</TableHead>
                  <TableHead>VMID</TableHead>
                  <TableHead>Template Name</TableHead>
                  <TableHead>Storage Node</TableHead>
                  <TableHead>Disk Size</TableHead>
                  <TableHead>Guest agent</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last synced</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {templateRows.length ? templateRows.map((template: NodeTemplateRow, index: number) => (
                  <TableRow key={`${template.id || template.proxmoxVmid || template.name}-${index}`}>
                    <TableCell className="whitespace-nowrap">{templateOsGroup(template)}</TableCell>
                    <TableCell className="whitespace-nowrap font-mono text-xs">{templateOsType(template)}</TableCell>
                    <TableCell className="font-mono">{template.proxmoxVmid || (template as any).vmid || "-"}</TableCell>
                    <TableCell className="min-w-48"><div className="truncate font-medium">{template.name}</div></TableCell>
                    <TableCell className="whitespace-nowrap">{template.proxmoxStorage || template.storage || "-"}</TableCell>
                    <TableCell className="whitespace-nowrap">{templateDiskSize(template)}</TableCell>
                    <TableCell>{templateGuestAgentBadge(template)}</TableCell>
                    <TableCell><Badge variant={template.isActive === false ? "secondary" : template.isDefault ? "default" : "outline"}>{templateStatus(template)}</Badge></TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{formatDate(template.lastSyncedAt || null)}</TableCell>
                    <TableCell className="text-right">
                      {template.id ? (
                        <TemplateOptions
                          template={template}
                          busyPrefix={templateActionId}
                          onAction={(action) => action === "clone" || action === "edit_metadata" || action === "delete" || action === "verify_guest_agent" || action === "refresh_storage_mapping"
                            ? openTemplateDialog(template, action)
                            : templateAction(template, action)}
                        />
                      ) : <Badge variant="outline">Detected</Badge>}
                    </TableCell>
                  </TableRow>
                )) : <TableRow><TableCell colSpan={10} className="py-8 text-center text-sm text-muted-foreground">No templates discovered.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card id="isos" className="glass border-border/40">
          <CardHeader className="px-4 py-3">
            <CardTitle>ISOs</CardTitle>
            <CardDescription>Boot media discovered from node storage.</CardDescription>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Select value={isoStorage || "__auto__"} onValueChange={(value) => setIsoStorage(value === "__auto__" ? "" : value)}>
                    <SelectTrigger className="h-9 w-40"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__auto__">Default storage</SelectItem>
                      {storageRows.filter((pool) => pool.enabled).map((pool) => <SelectItem key={pool.id} value={pool.storageId}>{pool.displayName || pool.storageId}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-border/40 px-3 text-sm hover:bg-accent">
                    <Upload className="h-4 w-4" />
                    {isoUploading ? "Uploading..." : "Upload ISO"}
                    <input id="upload-iso-control" type="file" accept=".iso,application/x-iso9660-image" className="hidden" disabled={isoUploading} onChange={(event) => void uploadIso(event.target.files?.[0] || null)} />
                  </label>
                </div>
              </div>
              <div className="max-h-72 overflow-y-auto rounded-md border border-border/30">
                {(node.isos || []).length ? (node.isos || []).slice(0, 20).map((iso, index) => (
                  <div key={`${iso.storage}-${iso.name}-${index}`} className="border-b border-border/20 px-3 py-2 last:border-0">
                    <div className="truncate text-sm font-medium">{iso.name}</div>
                    <div className="truncate text-xs text-muted-foreground">{iso.storage || "storage"}{iso.size ? ` · ${iso.size}` : ""}</div>
                  </div>
                )) : <div className="px-3 py-8 text-center text-sm text-muted-foreground">No ISOs discovered.</div>}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card id="storage-pools" className="glass border-border/40">
        <CardHeader>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <CardTitle>Storage Pools</CardTitle>
              <CardDescription>Manage default placement, premium storage, upgrade rules, and per-GB pricing for this compute node.</CardDescription>
            </div>
            <Button type="button" variant="outline" onClick={syncStoragePools} disabled={refreshing} className="gap-2">
              <RefreshCw className="h-4 w-4" />Sync storage pools
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-5">
            <StorageSummary label="Total storage" value={formatGbCapacity(totalStorageBytes)} />
            <StorageSummary label="Used storage" value={formatGbCapacity(usedStorageBytes)} />
            <StorageSummary label="Available storage" value={formatGbCapacity(availableStorageBytes)} />
            <StorageSummary label="Default pool" value={defaultPool?.displayName || defaultPool?.storageId || "-"} />
            <StorageSummary label="Premium pools" value={String(premiumCount)} />
          </div>
          <div className="overflow-x-auto">
          <Table>
	            <TableHeader><TableRow><TableHead>Storage</TableHead><TableHead>Total</TableHead><TableHead>Status</TableHead><TableHead>Health</TableHead><TableHead>Class</TableHead><TableHead>Policy</TableHead><TableHead>Priority</TableHead><TableHead>Price / GB</TableHead><TableHead>Min GB</TableHead><TableHead>Max GB</TableHead><TableHead>Default</TableHead><TableHead>Customer Selectable</TableHead><TableHead>Upgrade Only</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
            <TableBody>
              {storageRows.length ? storageRows.map((config) => {
                const pool = node.storage.find((item) => item.name === config.storageId)
                const availablePercent = bytesToGbDecimal(config.totalBytes) > 0 ? (bytesToGbDecimal(config.availableBytes || config.freeBytes) / bytesToGbDecimal(config.totalBytes)) * 100 : 100
                const lowCapacity = availablePercent < 15
                const criticalCapacity = availablePercent < 5
                return (
                <TableRow key={config.id}>
	                  <TableCell><div className="font-medium">{storageClassBadge(config)}</div></TableCell>
	                  <TableCell>{pool?.total || formatGbCapacity(config.totalBytes)}</TableCell>
                  <TableCell><Badge variant={!config.enabled || config.missingFromProxmox ? "destructive" : "default"}>{config.missingFromProxmox ? "missing" : config.enabled ? "active" : "disabled"}</Badge></TableCell>
                  <TableCell><Badge variant={config.healthStatus === "healthy" ? "outline" : "secondary"}>{config.healthStatus || "unknown"}</Badge></TableCell>
                  <TableCell><Badge variant="outline">{storageClassBadge(config)}</Badge></TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {(config?.isDefaultForNewVms ?? config?.defaultForNewVm) ? <Badge>Default</Badge> : null}
                      {config?.defaultForVmDisk || config?.defaultDiskTarget ? <Badge variant="outline">VM disk</Badge> : null}
                      {config?.defaultForTemplate || config?.defaultTemplateTarget ? <Badge variant="outline">Template</Badge> : null}
                      {config?.defaultForBackup || config?.backupStorage ? <Badge variant="outline">Backup</Badge> : null}
                      {config?.isCustomerSelectable || config?.allowNewPurchase ? <Badge variant="outline">Customer selectable</Badge> : null}
                      {config?.isUpgradeOnly ? <Badge variant="outline">Upgrade only</Badge> : null}
                      {config?.isPremium || config?.premium ? <Badge variant="outline">Premium</Badge> : null}
                      {!config?.enabled ? <Badge variant="destructive">Disabled</Badge> : null}
                      {lowCapacity ? <Badge variant={criticalCapacity ? "destructive" : "secondary"}>{criticalCapacity ? "Critical" : "Low capacity"}</Badge> : null}
                    </div>
                  </TableCell>
                  <TableCell>{config.priority ?? config.storagePriority ?? config.sortOrder ?? "-"}</TableCell>
                  <TableCell>₹{Number(config.pricePerGbMonthInr ?? config.pricePerGbMonthly ?? 0).toLocaleString("en-IN")}/GB</TableCell>
                  <TableCell>{config.minDiskSizeGb ?? config.minGb ?? 1}</TableCell>
                  <TableCell>{config.maxDiskSizeGb ?? config.maxGb ?? "-"}</TableCell>
                  <TableCell>{(config.isDefaultForNewVms ?? config.defaultForNewVm) ? <Check className="h-4 w-4 text-emerald-400" /> : "-"}</TableCell>
                  <TableCell>{config.isCustomerSelectable || config.allowNewPurchase ? "Yes" : "No"}</TableCell>
                  <TableCell>{config.isUpgradeOnly ? "Yes" : "No"}</TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button type="button" size="icon" variant="outline"><MoreHorizontal className="h-4 w-4" /></Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-56">
                        <DropdownMenuLabel>Storage actions</DropdownMenuLabel>
                        <DropdownMenuItem onClick={() => setStorageDraft({ ...config })}><Edit className="mr-2 h-4 w-4" />Edit</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => storageAction(config, "set-default")}>Set default</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => updateStorageConfig(config, { defaultForVmDisk: true, defaultDiskTarget: true })}>Set default VM disk</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => updateStorageConfig(config, { defaultForTemplate: true, defaultTemplateTarget: true })}>Set default template target</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => updateStorageConfig(config, { defaultForBackup: true, backupStorage: true })}>Set backup storage</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => storageAction(config, config.enabled ? "disable" : "enable")}>{config.enabled ? "Disable" : "Enable"}</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => updateStorageConfig(config, { isPremium: !(config.isPremium || config.premium), premium: !(config.isPremium || config.premium) })}><Star className="mr-2 h-4 w-4" />{config.isPremium || config.premium ? "Mark basic" : "Mark premium"}</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => updateStorageConfig(config, { isUpgradeOnly: !config.isUpgradeOnly })}>{config.isUpgradeOnly ? "Allow new purchases" : "Upgrade only"}</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={syncStoragePools}><RefreshCw className="mr-2 h-4 w-4" />Sync pools</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => toast.info(`${config.displayName || config.storageId}: ${formatGbCapacity(config.availableBytes || config.freeBytes)} available`)}><Eye className="mr-2 h-4 w-4" />View capacity</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
	              )}) : <TableRow><TableCell colSpan={14} className="py-8 text-center text-muted-foreground">No storage pools returned.</TableCell></TableRow>}
            </TableBody>
          </Table>
          </div>
        </CardContent>
      </Card>

      <Card className="glass border-border/40">
        <CardHeader>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
	            <CardTitle>Virtual Machines</CardTitle>
	            <CardDescription>Active VM inventory. Templates are managed from Operating Systems.</CardDescription>
            </div>
            <div className="relative w-full lg:w-80">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-9" placeholder="Search VM, IP, status" value={vmSearch} onChange={(event) => { setVmSearch(event.target.value); setVmPage(1) }} />
            </div>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
	            <TableHeader className="sticky top-0 z-10 bg-background"><TableRow><TableHead>VMID</TableHead><TableHead>Hostname</TableHead><TableHead>Status</TableHead><TableHead>CPU</TableHead><TableHead>RAM</TableHead><TableHead>Disk</TableHead><TableHead>IP</TableHead><TableHead>OS</TableHead><TableHead>Uptime</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
            <TableBody>
              {pagedVmGuests.length ? pagedVmGuests.map((guest) => (
                <TableRow key={`${guest.type}-${guest.vmid}`}>
                  <TableCell className="font-mono">{guest.vmid}</TableCell>
                  <TableCell className="font-medium">{guest.name}</TableCell>
                  <TableCell><Badge variant={guest.status === "running" ? "default" : "secondary"}>{guest.status}</Badge></TableCell>
                  <TableCell>{guest.cpuCores}</TableCell>
                  <TableCell>{guest.memory}</TableCell>
                  <TableCell>{guest.disk}</TableCell>
                  <TableCell className="font-mono text-xs">
                    <span className="inline-flex items-center gap-1">
                      {guest.ipAddress || "-"}
                      {guest.ipAddress ? <Button type="button" size="icon" variant="ghost" className="h-6 w-6" onClick={() => copyText(guest.ipAddress, "IP copied")}><Copy className="h-3.5 w-3.5" /></Button> : null}
                    </span>
                  </TableCell>
                  <TableCell>{guest.os || guest.type || "-"}</TableCell>
                  <TableCell>{guest.uptime || "-"}</TableCell>
                  <TableCell className="text-right">
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/admin/vms?search=${encodeURIComponent(String(guest.vmid))}`}><ExternalLink className="mr-2 h-4 w-4" />Connect</Link>
                    </Button>
                  </TableCell>
                </TableRow>
	              )) : <TableRow><TableCell colSpan={10} className="py-8 text-center text-muted-foreground">No virtual machines returned.</TableCell></TableRow>}
            </TableBody>
          </Table>
          <div className="mt-4 flex items-center justify-between text-sm">
            <p className="text-muted-foreground">Page {Math.min(vmPage, vmPages)} of {vmPages} · {filteredVmGuests.length.toLocaleString()} VMs</p>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="outline" disabled={vmPage <= 1} onClick={() => setVmPage((page) => Math.max(1, page - 1))}>Previous</Button>
              <Button type="button" size="sm" variant="outline" disabled={vmPage >= vmPages} onClick={() => setVmPage((page) => Math.min(vmPages, page + 1))}>Next</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog open={Boolean(templateDialog)} onOpenChange={(open) => {
        if (!open) setTemplateDialog(null)
      }}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {templateDialog?.action === "clone" ? "Clone Template" : templateDialog?.action === "edit_metadata" ? "Edit Template Metadata" : templateDialog?.action === "delete" ? "Delete Template" : templateDialog?.action === "verify_guest_agent" ? "Verify Guest Agent" : "Refresh Storage Mapping"}
            </DialogTitle>
            <DialogDescription>{templateDialog?.template.name}</DialogDescription>
          </DialogHeader>
          {templateDialog?.action === "clone" ? (
            <div className="grid gap-4">
              <DraftField label="New VMID" value={templateDialog.newVmid} type="number" onChange={(value) => setTemplateDialog((current) => current?.action === "clone" ? { ...current, newVmid: value } : current)} />
              <DraftField label="Template name" value={templateDialog.name} onChange={(value) => setTemplateDialog((current) => current?.action === "clone" ? { ...current, name: value } : current)} />
              <DraftField label="Target storage" value={templateDialog.storage} onChange={(value) => setTemplateDialog((current) => current?.action === "clone" ? { ...current, storage: value } : current)} />
            </div>
          ) : null}
          {templateDialog?.action === "edit_metadata" ? (
            <div className="grid gap-4 md:grid-cols-2">
              <DraftField label="Template name" value={templateDialog.name} onChange={(value) => setTemplateDialog((current) => current?.action === "edit_metadata" ? { ...current, name: value } : current)} />
              <DraftField label="OS type" value={templateDialog.osType} onChange={(value) => setTemplateDialog((current) => current?.action === "edit_metadata" ? { ...current, osType: value } : current)} />
              <DraftField label="OS group" value={templateDialog.osFamily} onChange={(value) => setTemplateDialog((current) => current?.action === "edit_metadata" ? { ...current, osFamily: value } : current)} />
              <DraftField label="Version" value={templateDialog.osVersion} onChange={(value) => setTemplateDialog((current) => current?.action === "edit_metadata" ? { ...current, osVersion: value } : current)} />
              <DraftField label="Storage node" value={templateDialog.storage} onChange={(value) => setTemplateDialog((current) => current?.action === "edit_metadata" ? { ...current, storage: value } : current)} />
              <DraftField label="Disk size GB" type="number" value={templateDialog.diskGb} onChange={(value) => setTemplateDialog((current) => current?.action === "edit_metadata" ? { ...current, diskGb: value } : current)} />
              <div className="space-y-2 md:col-span-2">
                <ToggleRow label="Guest agent verified" description="Marks the template as verified to carry a working QEMU Guest Agent. Guest automation configures servers through the agent only, so a template without one cannot be provisioned." checked={templateDialog.cloudInitSupported} onChange={(checked) => setTemplateDialog((current) => current?.action === "edit_metadata" ? { ...current, cloudInitSupported: checked } : current)} />
                <ToggleRow label="Reinstall enabled" description="Allows this template to appear in reinstall workflows." checked={templateDialog.reinstallEnabled} onChange={(checked) => setTemplateDialog((current) => current?.action === "edit_metadata" ? { ...current, reinstallEnabled: checked } : current)} />
                <ToggleRow label="Template enabled" description="Enabled templates can be selected for provisioning." checked={templateDialog.isActive} onChange={(checked) => setTemplateDialog((current) => current?.action === "edit_metadata" ? { ...current, isActive: checked } : current)} />
              </div>
            </div>
          ) : null}
          {templateDialog && templateDialog.action !== "clone" && templateDialog.action !== "edit_metadata" ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Type <span className="font-mono text-foreground">{templateDialog.action === "delete" ? "delete" : templateDialog.action === "verify_guest_agent" ? "verify" : "refresh"}</span> to confirm this action.
              </p>
              <DraftField label="Confirmation" value={templateDialog.confirm} onChange={(value) => setTemplateDialog((current) => current && current.action !== "clone" && current.action !== "edit_metadata" ? { ...current, confirm: value } : current)} />
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setTemplateDialog(null)}>Cancel</Button>
            <Button type="button" variant={templateDialog?.action === "delete" ? "destructive" : "default"} onClick={() => void submitTemplateDialog()}>{templateDialog?.action === "delete" ? "Delete" : "Confirm"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(storageDraft)} onOpenChange={(open) => {
        if (!open) {
          setStorageDraft(null)
          setStorageFocus(false)
        }
      }}>
        <DialogContent className="flex max-h-[90vh] max-w-2xl flex-col overflow-hidden p-0">
          <DialogHeader className="border-b border-border/40 px-6 py-4">
            <DialogTitle>Edit Storage Pool</DialogTitle>
            <DialogDescription>Update default placement, customer selection, premium storage, and monthly per-GB pricing.</DialogDescription>
          </DialogHeader>
          {storageDraft ? (
            <div className="grid gap-4 overflow-y-auto px-6 py-4 md:grid-cols-2">
              <DraftField label="Proxmox storage ID" value={storageDraft.proxmoxStorageId || storageDraft.storageId} readOnly onFocus={() => setStorageFocus(true)} onBlur={() => setStorageFocus(false)} onChange={() => undefined} />
              <DraftField label="Display name" value={storageDraft.displayName || ""} onFocus={() => setStorageFocus(true)} onBlur={() => setStorageFocus(false)} onChange={(value) => setStorageDraft((current) => current ? { ...current, displayName: value } : current)} />
              <div className="space-y-2">
                <Label>Disk class</Label>
                <Select value={String(storageDraft.diskClass || storageDraft.storageType || "CUSTOM")} onValueChange={(value) => setStorageDraft((current) => current ? { ...current, diskClass: value, storageType: value } : current)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STORAGE_CLASS_OPTIONS.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {(storageDraft.diskClass || storageDraft.storageType) === "CUSTOM" ? <DraftField label="Custom label" value={storageDraft.customDiskLabel || storageDraft.customStorageLabel || ""} onFocus={() => setStorageFocus(true)} onBlur={() => setStorageFocus(false)} onChange={(value) => setStorageDraft((current) => current ? { ...current, customDiskLabel: value, customStorageLabel: value } : current)} /> : null}
              <DraftField label="Price per GB / month (INR)" type="number" value={String(storageDraft.pricePerGbMonthInr ?? storageDraft.pricePerGbMonthly ?? 0)} onFocus={() => setStorageFocus(true)} onBlur={() => setStorageFocus(false)} onChange={(value) => setStorageDraft((current) => current ? { ...current, pricePerGbMonthInr: value, pricePerGbMonthly: value } : current)} />
              <DraftField label="Storage priority" type="number" value={String(storageDraft.priority ?? storageDraft.storagePriority ?? storageDraft.sortOrder ?? 100)} onFocus={() => setStorageFocus(true)} onBlur={() => setStorageFocus(false)} onChange={(value) => setStorageDraft((current) => current ? { ...current, priority: value, storagePriority: value } : current)} />
              <DraftField label="Minimum disk size GB" type="number" value={String(storageDraft.minDiskSizeGb ?? storageDraft.minGb ?? 1)} onFocus={() => setStorageFocus(true)} onBlur={() => setStorageFocus(false)} onChange={(value) => setStorageDraft((current) => current ? { ...current, minDiskSizeGb: value, minGb: value } : current)} />
              <DraftField label="Maximum disk size GB" type="number" value={storageDraft.maxDiskSizeGb == null && storageDraft.maxGb == null ? "" : String(storageDraft.maxDiskSizeGb ?? storageDraft.maxGb)} onFocus={() => setStorageFocus(true)} onBlur={() => setStorageFocus(false)} onChange={(value) => setStorageDraft((current) => current ? { ...current, maxDiskSizeGb: value, maxGb: value } : current)} />
              <div className="space-y-3 md:col-span-2">
                <ToggleRow label="Default for new VMs" description="New VMs are created on this pool unless the product or order specifies another storage policy." checked={Boolean(storageDraft.isDefaultForNewVms ?? storageDraft.defaultForNewVm)} onChange={(checked) => setStorageDraft((current) => current ? { ...current, isDefaultForNewVms: checked, defaultForNewVm: checked } : current)} />
                <ToggleRow label="Default VM disk target" description="Primary VM disks should be placed on this pool by default." checked={Boolean(storageDraft.defaultForVmDisk ?? storageDraft.defaultDiskTarget ?? storageDraft.defaultForNewVm)} onChange={(checked) => setStorageDraft((current) => current ? { ...current, defaultForVmDisk: checked, defaultDiskTarget: checked } : current)} />
                <ToggleRow label="Default template target" description="Template clone and sync operations should prefer this pool." checked={Boolean(storageDraft.defaultForTemplate ?? storageDraft.defaultTemplateTarget)} onChange={(checked) => setStorageDraft((current) => current ? { ...current, defaultForTemplate: checked, defaultTemplateTarget: checked } : current)} />
                <ToggleRow label="Backup storage" description="Node backup operations should prefer this storage pool." checked={Boolean(storageDraft.defaultForBackup ?? storageDraft.backupStorage)} onChange={(checked) => setStorageDraft((current) => current ? { ...current, defaultForBackup: checked, backupStorage: checked } : current)} />
                <ToggleRow label="Customer selectable during new order" description="Customers can choose this storage type during custom configuration when storage selection is enabled." checked={Boolean(storageDraft.isCustomerSelectable || storageDraft.allowNewPurchase)} onChange={(checked) => setStorageDraft((current) => current ? { ...current, isCustomerSelectable: checked, allowNewPurchase: checked } : current)} />
                <ToggleRow label="Upgrade only" description="This pool is hidden during initial purchase and available only for paid upgrades or admin migration." checked={Boolean(storageDraft.isUpgradeOnly)} onChange={(checked) => setStorageDraft((current) => current ? { ...current, isUpgradeOnly: checked, allowUpgrade: checked } : current)} />
                <ToggleRow label="Premium storage" description="Used for UI badges and premium pricing." checked={Boolean(storageDraft.isPremium || storageDraft.premium)} onChange={(checked) => setStorageDraft((current) => current ? { ...current, isPremium: checked, premium: checked } : current)} />
                <ToggleRow label="Enabled" description="Disabled pools cannot be selected for provisioning or upgrade." checked={Boolean(storageDraft.isEnabled ?? storageDraft.enabled)} onChange={(checked) => setStorageDraft((current) => current ? { ...current, isEnabled: checked, enabled: checked } : current)} />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>Notes</Label>
                <Textarea value={storageDraft.notes || ""} onFocus={() => setStorageFocus(true)} onBlur={() => setStorageFocus(false)} onChange={(event) => setStorageDraft((current) => current ? { ...current, notes: event.target.value } : current)} placeholder="Admin-only note" />
              </div>
            </div>
          ) : null}
          <DialogFooter className="sticky bottom-0 border-t border-border/40 bg-background px-6 py-4">
            <Button type="button" variant="outline" onClick={() => setStorageDraft(null)}>Cancel</Button>
            <Button type="button" onClick={saveStorageDraft} disabled={storageSaving} className="gap-2"><Save className="h-4 w-4" />{storageSaving ? "Saving..." : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function NodeDetailActions({
  host,
  refreshing,
  onRefresh,
  onSyncTemplates,
  onUploadIso,
}: {
  host: string
  refreshing: boolean
  onRefresh: () => void
  onSyncTemplates: () => void
  onUploadIso: () => void
}) {
  const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" })
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" className="gap-2">
          <MoreHorizontal className="h-4 w-4" />
          Actions
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Node actions</DropdownMenuLabel>
        <DropdownMenuItem onClick={() => jump("live-metrics")}><Eye className="mr-2 h-4 w-4" />View node</DropdownMenuItem>
        <DropdownMenuItem asChild><a href={host} target="_blank" rel="noreferrer"><ExternalLink className="mr-2 h-4 w-4" />Open Proxmox</a></DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => jump("templates")}><Database className="mr-2 h-4 w-4" />Templates</DropdownMenuItem>
        <DropdownMenuItem onClick={() => jump("isos")}><Upload className="mr-2 h-4 w-4" />ISOs</DropdownMenuItem>
        <DropdownMenuItem onClick={() => jump("templates")}>Enable template</DropdownMenuItem>
        <DropdownMenuItem onClick={() => jump("templates")}>Disable template</DropdownMenuItem>
        <DropdownMenuItem onClick={onUploadIso}><Upload className="mr-2 h-4 w-4" />Upload ISO</DropdownMenuItem>
        <DropdownMenuItem onClick={() => jump("network-usage")}><Network className="mr-2 h-4 w-4" />Network usage</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={refreshing} onClick={onSyncTemplates}><RefreshCw className="mr-2 h-4 w-4" />Sync templates</DropdownMenuItem>
        <DropdownMenuItem disabled={refreshing} onClick={onRefresh}><RefreshCw className="mr-2 h-4 w-4" />Refresh metrics</DropdownMenuItem>
        <DropdownMenuItem onClick={() => jump("logs")}><Activity className="mr-2 h-4 w-4" />Restart node services</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function TemplateOptions({
  template,
  busyPrefix,
  onAction,
}: {
  template: NodeTemplateRow
  busyPrefix: string | null
  onAction: (action: "enable" | "disable" | "set_default" | "sync" | "clone" | "edit_metadata" | "delete" | "open_proxmox" | "verify_guest_agent" | "refresh_storage_mapping") => void | Promise<void>
}) {
  const busy = Boolean(busyPrefix?.startsWith(`${template.id}:`))
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" size="sm" variant="outline" className="gap-2" disabled={busy}>
          <MoreHorizontal className="h-4 w-4" />
          Options
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel>Template options</DropdownMenuLabel>
        <DropdownMenuItem onClick={() => onAction("enable")}>Enable template</DropdownMenuItem>
        <DropdownMenuItem onClick={() => onAction("disable")}>Disable template</DropdownMenuItem>
        <DropdownMenuItem onClick={() => onAction("set_default")}>Set as default</DropdownMenuItem>
        <DropdownMenuItem onClick={() => onAction("sync")}><RefreshCw className="mr-2 h-4 w-4" />Sync template</DropdownMenuItem>
        <DropdownMenuItem onClick={() => onAction("clone")}>Clone template</DropdownMenuItem>
        <DropdownMenuItem onClick={() => onAction("edit_metadata")}><Edit className="mr-2 h-4 w-4" />Edit metadata</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => onAction("open_proxmox")}><ExternalLink className="mr-2 h-4 w-4" />Open in Proxmox</DropdownMenuItem>
        <DropdownMenuItem onClick={() => onAction("verify_guest_agent")}>Verify guest agent</DropdownMenuItem>
        <DropdownMenuItem onClick={() => onAction("refresh_storage_mapping")}>Refresh storage mapping</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => onAction("delete")}><Trash2 className="mr-2 h-4 w-4" />Delete template</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function StorageSummary({ label, value }: { label: string; value: string }) {
  return <div className="rounded-md border border-border/30 p-3"><div className="text-xs text-muted-foreground">{label}</div><div className="mt-1 truncate text-sm font-semibold">{value}</div></div>
}

function DraftField({ label, value, onChange, onFocus, onBlur, type = "text", readOnly = false }: { label: string; value: string; onChange: (value: string) => void; onFocus?: () => void; onBlur?: () => void; type?: string; readOnly?: boolean }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input type={type} value={value} readOnly={readOnly} onFocus={onFocus} onBlur={onBlur} onChange={(event) => onChange(event.target.value)} />
    </div>
  )
}

function ToggleRow({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-md border border-border/30 p-3">
      <div>
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{description}</div>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  )
}

function MetricCard({ icon: Icon, title, value, detail, progress, trend }: { icon: any; title: string; value: string; detail: string; progress?: number; trend?: number[] }) {
  return (
    <Card className="glass border-border/40">
      <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><Icon className="h-4 w-4" />{title}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="text-2xl font-semibold capitalize">{value}</div>
        <div className="text-xs text-muted-foreground">{detail}</div>
        {typeof progress === "number" ? <Usage value={progress} /> : null}
        {trend?.length ? <Sparkline values={trend} /> : null}
      </CardContent>
    </Card>
  )
}

function InfoCard({ icon: Icon, title, value, detail, trend }: { icon: any; title: string; value: string | number; detail: string; trend?: number[] }) {
  return (
    <Card className="glass border-border/40">
      <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><Icon className="h-4 w-4" />{title}</CardTitle></CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold">{value}</div>
        <div className="mt-2 text-xs text-muted-foreground">{detail}</div>
        {trend?.length ? <div className="mt-3"><Sparkline values={trend} /></div> : null}
      </CardContent>
    </Card>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div className="rounded-md border border-border/30 p-3"><div className="text-xs text-muted-foreground">{label}</div><div className="mt-1 truncate font-medium">{value}</div></div>
}

function Usage({ value }: { value: number }) {
  return <Progress value={value || 0} className={value >= 95 ? "bg-destructive/20 [&_[data-slot=progress-indicator]]:bg-destructive" : value >= 85 ? "bg-amber-500/20 [&_[data-slot=progress-indicator]]:bg-amber-500" : ""} />
}

function Sparkline({ values }: { values: number[] }) {
  const clean = values.filter((value) => Number.isFinite(value))
  if (clean.length < 2) return null
  const max = Math.max(...clean, 1)
  const min = Math.min(...clean, 0)
  const spread = Math.max(1, max - min)
  const points = clean.map((value, index) => {
    const x = clean.length === 1 ? 0 : (index / (clean.length - 1)) * 100
    const y = 28 - ((value - min) / spread) * 24
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(" ")

  return (
    <svg viewBox="0 0 100 32" preserveAspectRatio="none" className="h-8 w-full overflow-visible text-primary/80" aria-hidden="true">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

function LiveBadge({ state }: { state: "connected" | "reconnecting" | "offline" | "paused" }) {
  if (state === "paused") return <Badge variant="secondary"><Pause className="mr-1 h-3 w-3" />Paused</Badge>
  if (state === "offline") return <Badge variant="destructive"><Wifi className="mr-1 h-3 w-3" />Offline</Badge>
  if (state === "reconnecting") return <Badge variant="secondary"><Wifi className="mr-1 h-3 w-3" />Reconnecting</Badge>
  return <Badge><Wifi className="mr-1 h-3 w-3" />Connected</Badge>
}

function StatusBadge({ status, critical }: { status: string; critical?: boolean }) {
  if (status === "connected") return <Badge>Connected</Badge>
  if (status === "warning") return <Badge variant="secondary">{critical ? "Critical" : "Warning"}</Badge>
  if (status === "failed") return <Badge variant="destructive">Failed</Badge>
  return <Badge variant="secondary">Unknown</Badge>
}
