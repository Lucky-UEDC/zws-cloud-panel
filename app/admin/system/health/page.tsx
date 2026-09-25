import { headers } from "next/headers"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { SystemHealthRepairButton } from "@/components/admin/system-health-repair-button"
import { readJsonResponse } from "@/lib/client/safe-json"

export const dynamic = "force-dynamic"
export const revalidate = 0

async function loadHealth() {
  const h = await headers()
  const host = h.get("host")
  const proto = h.get("x-forwarded-proto") || "https"
  const cookie = h.get("cookie") || ""
  if (!host) return { success: false, error: "Health check host header missing" }
  const response = await fetch(`${proto}://${host}/api/admin/system/health`, {
    cache: "no-store",
    headers: { cookie },
  })
  return readJsonResponse<any>(response).catch(() => ({ success: false, error: "Health check failed" }))
}

function Status({ ok, label }: { ok: boolean; label: string }) {
  return <Badge variant={ok ? "default" : "destructive"}>{label}</Badge>
}

export default async function AdminSystemHealthPage() {
  const health = await loadHealth()
  const schema = health.schema || {}
  const missingColumns = Array.isArray(schema.missingColumns) ? schema.missingColumns : []
  const missingTables = Array.isArray(schema.missingTables) ? schema.missingTables : []
  const pendingMigrations = Array.isArray(schema.pendingMigrations) ? schema.pendingMigrations : []
  const failedMigrations = Array.isArray(schema.failedMigrations) ? schema.failedMigrations : []

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold">System Health</h1>
          <p className="mt-1 text-sm text-muted-foreground">Production database, workers, queues, Proxmox, and WhatsApp checks.</p>
        </div>
        <SystemHealthRepairButton />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle>Prisma</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Status ok={Boolean(health.prisma?.ok)} label={health.prisma?.ok ? "Connected" : "Problem"} />
            {health.prisma?.warning ? <p className="text-amber-300">{health.prisma.warning}</p> : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Schema</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Status ok={Boolean(schema.ok)} label={schema.ok ? "Compatible" : "Mismatch"} />
            <div className="text-muted-foreground">Missing tables: {missingTables.length}</div>
            <div className="text-muted-foreground">Missing columns: {missingColumns.length}</div>
            <div className="text-muted-foreground">Pending migrations: {pendingMigrations.length}</div>
            <div className="text-muted-foreground">Failed migrations: {failedMigrations.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>App</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div>Commit: <span className="font-mono">{health.app?.commit || "unknown"}</span></div>
            <div className="text-muted-foreground">Checked: {health.checkedAt ? new Date(health.checkedAt).toLocaleString("en-IN") : "-"}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Redis</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Status ok={Boolean(health.redis?.ok)} label={health.redis?.ok ? "Connected" : "Problem"} />
            <div className="text-muted-foreground">{health.redis?.message || "No Redis status reported"}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Provisioning</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Status ok={!health.provisioning?.warning} label={health.provisioning?.warning ? "Problem" : "Ready"} />
            <div className="text-muted-foreground">Recoverable orders: {health.provisioning?.recoverableOrders ?? 0}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Missing Schema Items</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          {[...missingTables.map((table: string) => `table ${table}`), ...missingColumns.map((item: any) => `column ${item.table}.${item.column}`), ...pendingMigrations.map((name: string) => `pending migration ${name}`), ...failedMigrations.map((name: string) => `failed migration ${name}`)].map((item) => (
            <div key={item} className="font-mono text-xs text-amber-300">{item}</div>
          ))}
          {!missingTables.length && !missingColumns.length && !pendingMigrations.length && !failedMigrations.length ? <div className="text-muted-foreground">No schema problems detected.</div> : null}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Workers</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {(health.workers || []).map((worker: any) => (
              <div key={worker.service} className="flex items-center justify-between gap-3">
                <span className="font-mono text-xs">{worker.service}</span>
                <Badge variant={worker.active === "active" ? "default" : "destructive"}>{worker.active}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Queue</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {(health.queue?.rows || []).map((row: any) => (
              <div key={`${row.type}-${row.status}`} className="flex items-center justify-between gap-3">
                <span>{row.type} / {row.status}</span>
                <Badge variant="secondary">{row._count?._all || 0}</Badge>
              </div>
            ))}
            {health.queue?.warning ? <p className="text-amber-300">{health.queue.warning}</p> : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Proxmox</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {(health.proxmox?.nodes || []).map((node: any) => (
              <div key={node.id} className="flex items-center justify-between gap-3">
                <span>{node.name || node.nodeName}</span>
                <Status ok={Boolean(node.ok)} label={node.ok ? "OK" : "Problem"} />
              </div>
            ))}
            {health.proxmox?.warning ? <p className="text-amber-300">{health.proxmox.warning}</p> : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Templates, IPs, Storage</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <HealthGroups label="Templates" rows={health.provisioning?.templates || []} />
            <HealthGroups label="IP pools" rows={health.provisioning?.ipPools || []} />
            <HealthGroups label="Storage pools" rows={health.provisioning?.storagePools || []} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>WhatsApp</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div>Status: <span className="font-mono">{health.whatsapp?.runtime?.status || health.whatsapp?.runtime?.authStatus || "unknown"}</span></div>
            <div className="text-muted-foreground">Updated: {health.whatsapp?.runtime?.updatedAt ? new Date(health.whatsapp.runtime.updatedAt).toLocaleString("en-IN") : "-"}</div>
            {health.whatsapp?.warning ? <p className="text-amber-300">{health.whatsapp.warning}</p> : null}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function HealthGroups({ label, rows }: { label: string; rows: any[] }) {
  const total = rows.reduce((sum, row) => sum + Number(row?._count?._all || 0), 0)
  return (
    <div className="flex items-center justify-between gap-3">
      <span>{label}</span>
      <Badge variant="secondary">{total}</Badge>
    </div>
  )
}
