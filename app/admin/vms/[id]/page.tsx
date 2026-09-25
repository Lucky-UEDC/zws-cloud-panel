import Link from "next/link"
import { AlertTriangle, ArrowLeft, RefreshCw, Stethoscope } from "lucide-react"
import { Button } from "@/components/ui/button"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { getAdminVmDetails } from "@/lib/admin-vm-management"
import { getAdminFromCookies } from "@/lib/server-auth"
import { prisma } from "@/lib/db"
import { AdminVmEditDialog } from "@/components/admin/vms/admin-vm-edit-dialog"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function fetchVm(id: string) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) return null
  try {
    return await getAdminVmDetails(id) as any
  } catch (error: any) {
    console.error("[ADMIN_VM_DETAILS_FATAL]", {
      id,
      message: error?.message || String(error),
      code: error?.code || null,
      stack: error?.stack || null,
    })
    return {
      success: false,
      ok: false,
      fatalError: { code: error?.code || "VM_DETAILS_RENDER_FAILED", message: error?.message || "Unable to load VM details.", id },
      diagnostics: { latestError: error?.message || "Unable to load VM details." },
      warnings: [error?.message || "Unable to load VM details."],
      relations: [],
      overview: {},
      timeline: [],
      logs: [],
    }
  }
}

function text(value: unknown, fallback = "Unrecorded") {
  const normalized = value === null || value === undefined ? "" : String(value).trim()
  return normalized || fallback
}

function dateText(value: unknown) {
  if (!value) return "Unrecorded"
  const date = value instanceof Date ? value : new Date(String(value))
  return Number.isNaN(date.getTime()) ? "Unrecorded" : date.toLocaleString("en-IN")
}

export default async function AdminVmDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const data: any = await fetchVm(id)
  const overview: any = data?.overview || {}
  const vps: any = data?.vps || {}
  const lifecycle: any = data?.lifecycle || {}
  const diagnostics: any = data?.diagnostics || {}
  const fatalError: any = data?.fatalError || null
  const warnings: string[] = Array.isArray(data?.warnings) ? data.warnings : []
  const relations: any[] = Array.isArray(data?.relations) ? data.relations : Array.isArray(diagnostics.relations) ? diagnostics.relations : []
  const nodes = data ? await prisma.proxmoxNode.findMany({
    where: { isActive: true },
    select: { id: true, name: true, nodeName: true },
    orderBy: [{ name: "asc" }],
  }).catch(() => []) : []

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Button asChild variant="ghost" size="sm" className="mb-2">
            <Link href="/admin/vms"><ArrowLeft className="mr-2 h-4 w-4" />Back to Virtual Machines</Link>
          </Button>
          <h1 className="text-3xl font-semibold">{text(overview.hostname || vps.name, `VM ${text(overview.vmid || vps.vmid, id)}`)}</h1>
          <p className="mt-1 text-muted-foreground">Database/cache VM detail view. Proxmox is not queried while rendering this page.</p>
        </div>
        {vps?.id ? (
          <AdminVmEditDialog
            vpsId={vps.id}
            nodes={nodes.map((node) => ({ id: node.id, label: node.name || node.nodeName }))}
            initial={{
              cpuCores: overview.cpu || vps.cpuCores || null,
              ramGb: overview.ramGb || vps.ramGb || null,
              diskGb: overview.diskGb || vps.diskGb || null,
              nodeId: vps.proxmoxNodeId || null,
              ipAddress: overview.ipv4 || vps.ipAddress || null,
              username: vps.username || vps.adminUsername || null,
              hostname: overview.hostname || vps.name || null,
              macAddress: overview.macAddress || vps.vmMacAddress || null,
              renewalDueAt: lifecycle.renewalDueAt || overview.renewalDueAt || null,
            }}
          />
        ) : null}
      </div>

      {!data || fatalError || data?.ok === false || data?.success === false ? (
        <VmDetailsProblem id={id} fatalError={fatalError} diagnostics={diagnostics} relations={relations} warnings={warnings} />
      ) : null}

      {warnings.length && !fatalError ? (
        <section className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-500" />
            <div>
              <h2 className="text-sm font-semibold">VM details loaded with diagnostics</h2>
              <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                {warnings.slice(0, 6).map((warning) => <li key={warning}>{warning}</li>)}
              </ul>
            </div>
          </div>
        </section>
      ) : null}

      <section className="grid gap-4 md:grid-cols-4">
        <Fact label="Hostname" value={overview.hostname || vps.name} />
        <Fact label="VMID" value={overview.vmid || vps.vmid} fallback="Not mapped" />
        <Fact label="Assigned IP" value={overview.ipv4 || vps.ipAddress} fallback="No assigned IP" mono />
        <Fact label="MAC" value={overview.macAddress || vps.vmMacAddress} fallback="No MAC recorded" mono />
        <Fact label="Status" value={overview.status || vps.status} />
        <Fact label="Node" value={overview.node || vps.proxmoxNode?.nodeName || vps.proxmoxNode?.name} />
        <Fact label="CPU" value={overview.cpu ? `${overview.cpu} cores` : null} />
        <Fact label="RAM" value={overview.ramGb ? `${overview.ramGb} GB` : null} />
        <Fact label="Disk" value={overview.diskGb ? `${overview.diskGb} GB` : null} />
        <Fact label="Bandwidth" value={overview.bandwidth ? `${overview.bandwidth} TB` : null} />
        <Fact label="Region" value={vps.region || vps.proxmoxNode?.region || vps.proxmoxNode?.location} />
        <Fact label="Billing Date" value={dateText(lifecycle.renewalDueAt || overview.renewalDueAt || overview.renewalDate)} />
        <Fact label="Power State" value={overview.powerState} />
      </section>

      <section className="rounded-lg border border-border/40 bg-card">
        <div className="border-b p-4">
          <h2 className="text-lg font-semibold">Database Sources</h2>
        </div>
        <div className="grid gap-4 p-4 md:grid-cols-3">
          <Fact label="Metrics Source" value={data?.metricsSource?.runtime || "cached"} />
          <Fact label="Sync Status" value={diagnostics.syncStatus || "database"} />
          <Fact label="Provisioning" value={overview.provisioningStatus || data?.stateMachine?.provisioningStatus || vps.status} />
        </div>
      </section>

      <RelationDiagnostics relations={relations} />

      <section className="rounded-lg border border-border/40 bg-card">
        <div className="border-b p-4">
          <h2 className="text-lg font-semibold">Recent Activity</h2>
        </div>
        <div className="overflow-x-auto p-4">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-muted-foreground"><tr><th className="py-2">Step</th><th>Status</th><th>Created</th></tr></thead>
            <tbody>
              {(data?.timeline || []).slice(0, 12).map((row: any) => (
                <tr key={row.id} className="border-b"><td className="py-2">{text(row.label || row.step)}</td><td>{text(row.status)}</td><td>{dateText(row.createdAt)}</td></tr>
              ))}
              {!data?.timeline?.length ? <tr><td colSpan={3} className="py-8 text-center text-muted-foreground">No recent provisioning timeline entries recorded.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

function VmDetailsProblem({ id, fatalError, diagnostics, relations, warnings }: { id: string; fatalError: any; diagnostics: any; relations: any[]; warnings: string[] }) {
  const reason = fatalError?.message || diagnostics?.latestError || warnings[0] || "Unable to load VM details."
  const code = fatalError?.code || diagnostics?.errorCode || "VM_DETAILS_UNAVAILABLE"
  return (
    <section className="rounded-lg border border-destructive/40 bg-destructive/5 p-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="space-y-2">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            Unable to load VM details.
          </h2>
          <p className="text-sm text-muted-foreground">Reason: {reason}</p>
          <p className="font-mono text-xs text-muted-foreground">Code: {code}</p>
          {diagnostics?.supportCode ? <p className="font-mono text-xs text-muted-foreground">Support: {diagnostics.supportCode}</p> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={`/admin/vms/${encodeURIComponent(id)}`}><RefreshCw className="mr-2 h-4 w-4" />Retry</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href={`/admin/vms?vm=${encodeURIComponent(id)}`}><Stethoscope className="mr-2 h-4 w-4" />Diagnostics</Link>
          </Button>
        </div>
      </div>
      <RelationDiagnostics relations={relations} compact />
    </section>
  )
}

function RelationDiagnostics({ relations, compact = false }: { relations: any[]; compact?: boolean }) {
  if (!relations.length) return null
  return (
    <section className={`rounded-lg border border-border/40 bg-card ${compact ? "mt-4" : ""}`}>
      <div className="border-b p-4">
        <h2 className="text-lg font-semibold">Relation Diagnostics</h2>
      </div>
      <div className="overflow-x-auto p-4">
        <table className="w-full text-sm">
          <thead className="border-b text-left text-muted-foreground"><tr><th className="py-2">Relation</th><th>Status</th><th>Required</th><th>Repair</th></tr></thead>
          <tbody>
            {relations.map((relation) => (
              <tr key={relation.name} className="border-b">
                <td className="py-2">{text(relation.name)}</td>
                <td>{relation.exists ? "Exists" : "Missing"}</td>
                <td>{relation.required ? "Yes" : "No"}</td>
                <td>{relation.repairAvailable ? "Available" : "Manual review"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function Fact({ label, value, fallback = "Unrecorded", mono = false }: { label: string; value: unknown; fallback?: string; mono?: boolean }) {
  return (
    <div className="rounded-lg border border-border/40 bg-card p-4">
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div className={`mt-2 break-words text-lg font-semibold ${mono ? "font-mono" : ""}`}>{text(value, fallback)}</div>
    </div>
  )
}
