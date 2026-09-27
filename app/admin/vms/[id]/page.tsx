import Link from "next/link"
import { AlertTriangle, ArrowLeft, RefreshCw, Stethoscope, Server, Cpu, HardDrive, Wifi, Terminal, Shield } from "lucide-react"
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

  // Fetch metrics diagnostics from internal admin API (same auth context)
  let metricsDiagnostics: any = null
  if (vps?.id) {
    try {
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || `http://localhost:3000`
      const res = await fetch(`${baseUrl}/api/admin/vms/${encodeURIComponent(vps.id)}/metrics-diagnostics`, {
        cache: "no-store",
        headers: { Cookie: "" }, // Cookies are forwarded automatically in Server Components
      })
      if (res.ok) {
        const json = await res.json()
        metricsDiagnostics = json.diagnostics
      }
    } catch {
      // Diagnostics are supplemental; page remains usable
    }
  }

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

      {metricsDiagnostics ? (
        <section className="rounded-lg border border-border/40 bg-card">
          <div className="border-b p-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Metrics Diagnostics</h2>
            <Button variant="outline" size="sm" asChild>
              <Link href={`/api/admin/vms/${encodeURIComponent(vps.id)}/metrics-diagnostics`} target="_blank" rel="noopener noreferrer">
                <Terminal className="mr-2 h-4 w-4" />Open JSON
              </Link>
            </Button>
          </div>
          <div className="p-4 space-y-4">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-md border border-border/40 p-3">
                <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground"><Server className="h-4 w-4" />VM</div>
                <div className="mt-1 text-lg font-mono">{metricsDiagnostics.vps?.vmid || "?"}</div>
                <div className="text-xs text-muted-foreground">{metricsDiagnostics.vps?.node?.nodeName || "No node"}</div>
              </div>
              <div className="rounded-md border border-border/40 p-3">
                <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground"><Cpu className="h-4 w-4" />OS</div>
                <div className="mt-1 text-lg">{metricsDiagnostics.vps?.osDetected || "unknown"}</div>
                <div className="text-xs text-muted-foreground">{metricsDiagnostics.vps?.os || "No OS metadata"}</div>
              </div>
              <div className="rounded-md border border-border/40 p-3">
                <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground"><Shield className="h-4 w-4" />Guest Agent</div>
                <div className="mt-1 text-lg">{metricsDiagnostics.guestAgent?.reachable ? "Reachable" : "Unreachable"}</div>
                <div className="text-xs text-muted-foreground">Enabled: {metricsDiagnostics.guestAgent?.enabled ? "Yes" : "No"}</div>
              </div>
            </div>

            <div className="rounded-md border border-border/40 p-3">
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground"><HardDrive className="h-4 w-4" />Last Disk Collection</div>
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                <Fact label="Command" value={metricsDiagnostics.diskCollection?.commandType || "N/A"} mono />
                <Fact label="Duration" value={metricsDiagnostics.diskCollection?.collectionDurationMs ? `${metricsDiagnostics.diskCollection.collectionDurationMs} ms` : "N/A"} />
                <Fact label="Source" value={metricsDiagnostics.diskCollection?.source || "N/A"} />
                <Fact label="Checked At" value={metricsDiagnostics.diskCollection?.checkedAt ? new Date(metricsDiagnostics.diskCollection.checkedAt).toLocaleString("en-IN") : "Never"} />
                <Fact label="Error" value={metricsDiagnostics.diskCollection?.errorCode ? `${metricsDiagnostics.diskCollection.errorCode}: ${metricsDiagnostics.diskCollection.error}` : "None"} />
                <Fact label="Selected Volume" value={metricsDiagnostics.diskCollection?.selectedVolume ? `${metricsDiagnostics.diskCollection.selectedVolume.name} (${metricsDiagnostics.diskCollection.selectedVolume.filesystem || "N/A"})` : "N/A"} mono />
              </div>
            </div>

            {metricsDiagnostics.diskCollection?.volumes?.length ? (
              <div className="rounded-md border border-border/40 p-3">
                <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground"><HardDrive className="h-4 w-4" />All Volumes</div>
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b text-left text-muted-foreground">
                      <tr><th className="py-1 pr-4">Name</th><th className="py-1 pr-4">Mount/Drive</th><th className="py-1 pr-4">FS</th><th className="py-1 pr-4">Total</th><th className="py-1 pr-4">Used</th><th className="py-1 pr-4">Free</th><th className="py-1">System</th></tr>
                    </thead>
                    <tbody>
                      {metricsDiagnostics.diskCollection.volumes.map((v: any, idx: number) => (
                        <tr key={idx} className="border-b">
                          <td className="py-1 pr-4 font-mono">{v.name}</td>
                          <td className="py-1 pr-4">{v.mountpoint || "-"}</td>
                          <td className="py-1 pr-4">{v.filesystem || "-"}</td>
                          <td className="py-1 pr-4 text-right">{(v.totalBytes / 1_000_000_000).toFixed(2)} GB</td>
                          <td className="py-1 pr-4 text-right">{(v.usedBytes / 1_000_000_000).toFixed(2)} GB</td>
                          <td className="py-1 pr-4 text-right">{(v.freeBytes / 1_000_000_000).toFixed(2)} GB</td>
                          <td className="py-1">{v.system ? "Yes" : "No"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}

            <div className="rounded-md border border-border/40 p-3">
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground"><Wifi className="h-4 w-4" />Latest Metric</div>
              <div className="mt-2 grid gap-2 sm:grid-cols-4">
                {metricsDiagnostics.latestMetric ? (
                  <>
                    <Fact label="Recorded" value={metricsDiagnostics.latestMetric.recordedAt ? new Date(metricsDiagnostics.latestMetric.recordedAt).toLocaleString("en-IN") : "N/A"} />
                    <Fact label="CPU" value={metricsDiagnostics.latestMetric.cpuPercent ? `${metricsDiagnostics.latestMetric.cpuPercent}%` : "N/A"} />
                    <Fact label="RAM" value={metricsDiagnostics.latestMetric.ramUsedGb !== undefined ? `${metricsDiagnostics.latestMetric.ramUsedGb} / ${metricsDiagnostics.latestMetric.ramTotalGb} GB` : "N/A"} />
                    <Fact label="Disk" value={metricsDiagnostics.latestMetric.diskUsedGb !== undefined ? `${metricsDiagnostics.latestMetric.diskUsedGb} / ${metricsDiagnostics.latestMetric.diskTotalGb} GB (${metricsDiagnostics.latestMetric.diskFreeGb} free)` : "N/A"} />
                    <Fact label="Runtime" value={metricsDiagnostics.latestMetric.runtimeStatus || "N/A"} />
                    <Fact label="Source" value={metricsDiagnostics.latestMetric.source || "N/A"} />
                  </>
                ) : (
                  <Fact label="Status" value="No metrics recorded" />
                )}
              </div>
            </div>

            <div className="rounded-md border border-border/40 p-3">
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground"><Terminal className="h-4 w-4" />Recent Metric History (last 5)</div>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b text-left text-muted-foreground">
                    <tr><th className="py-1 pr-4">Time</th><th className="py-1 pr-4">Status</th><th className="py-1 pr-4">CPU</th><th className="py-1 pr-4">RAM</th><th className="py-1 pr-4">Disk</th><th className="py-1 pr-4">Source</th><th className="py-1">Disk Error</th></tr>
                  </thead>
                  <tbody>
                    {metricsDiagnostics.recentMetrics?.map((m: any, idx: number) => (
                      <tr key={idx} className="border-b">
                        <td className="py-1 pr-4">{new Date(m.recordedAt).toLocaleString("en-IN")}</td>
                        <td className="py-1 pr-4">{m.runtimeStatus || "N/A"}</td>
                        <td className="py-1 pr-4">{m.cpuPercent}%</td>
                        <td className="py-1 pr-4">{m.ramUsedGb} / {m.ramTotalGb} GB</td>
                        <td className="py-1 pr-4">{m.diskUsedGb} / {m.diskTotalGb} GB</td>
                        <td className="py-1 pr-4">{m.source || "N/A"}</td>
                        <td className="py-1">{m.diskErrorCode || "None"}</td>
                      </tr>
                    ))}
                    {!metricsDiagnostics.recentMetrics?.length ? <tr><td colSpan={7} className="py-4 text-center text-muted-foreground">No recent metrics</td></tr> : null}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rounded-md border border-border/40 p-3">
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground"><HardDrive className="h-4 w-4" />VpsInstance Disk Cache</div>
              <div className="mt-2 grid gap-2 sm:grid-cols-4">
                {metricsDiagnostics.vpsInstanceDiskCache ? (
                  <>
                    <Fact label="Used" value={metricsDiagnostics.vpsInstanceDiskCache.diskUsedGb !== null ? `${metricsDiagnostics.vpsInstanceDiskCache.diskUsedGb} GB` : "N/A"} />
                    <Fact label="Total" value={metricsDiagnostics.vpsInstanceDiskCache.diskTotalGb !== null ? `${metricsDiagnostics.vpsInstanceDiskCache.diskTotalGb} GB` : "N/A"} />
                    <Fact label="Percent" value={metricsDiagnostics.vpsInstanceDiskCache.diskUsagePercent !== null ? `${metricsDiagnostics.vpsInstanceDiskCache.diskUsagePercent}%` : "N/A"} />
                    <Fact label="Source" value={metricsDiagnostics.vpsInstanceDiskCache.diskUsageSource || "N/A"} />
                    <Fact label="Checked" value={metricsDiagnostics.vpsInstanceDiskCache.diskUsageCheckedAt ? new Date(metricsDiagnostics.vpsInstanceDiskCache.diskUsageCheckedAt).toLocaleString("en-IN") : "Never"} />
                  </>
                ) : (
                  <Fact label="Status" value="No disk cache recorded" />
                )}
              </div>
            </div>
          </div>
        </section>
      ) : null}

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
