import { headers } from "next/headers"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { readJsonResponse } from "@/lib/client/safe-json"
import { UpdateCenterClient } from "@/components/admin/update-center-client"

export const dynamic = "force-dynamic"
export const revalidate = 0

async function loadUpdates() {
  const h = await headers()
  const host = h.get("host")
  const proto = h.get("x-forwarded-proto") || "https"
  const cookie = h.get("cookie") || ""
  if (!host) return { success: false, error: "Host header missing" }
  const response = await fetch(`${proto}://${host}/api/admin/system/updates`, {
    cache: "no-store",
    headers: { cookie },
  })
  return readJsonResponse<any>(response).catch(() => ({ success: false, error: "Update center unavailable" }))
}

function StatusBadge({ status }: { status: string }) {
  const variant =
    status === "success"
      ? "default"
      : status === "failed" || status === "error" || status === "preflight_failed"
        ? "destructive"
        : status === "running" || status === "apply_pending"
          ? "secondary"
          : "outline"
  return <Badge variant={variant as any}>{status}</Badge>
}

export default async function AdminSystemUpdatesPage() {
  const updates = await loadUpdates()
  const current = updates.current || {}
  const releases = Array.isArray(updates.releases) ? updates.releases : []
  const history = Array.isArray(updates.history) ? updates.history : []

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold">System Updates</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Trusted releases from the configured GitHub repo. Anything without a valid, signed-format manifest is excluded and can never be applied.
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          {updates.configured ? (
            <Badge variant="outline">{updates.repo}</Badge>
          ) : (
            <Badge variant="destructive">Not configured</Badge>
          )}
        </div>
      </div>

      {updates.error ? (
        <Card>
          <CardContent className="pt-6 text-sm text-destructive">{updates.error}</CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle>Running</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Version</span>
              <Badge variant="secondary">{current.version || "unknown"}</Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Commit</span>
              <code className="text-xs">{current.commit || "—"}</code>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Built</span>
              <span>{current.builtAt ? new Date(current.builtAt).toLocaleString() : "—"}</span>
            </div>
            {updates.lockHeld ? (
              <p className="text-xs text-amber-300">An update is currently in progress.</p>
            ) : null}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Available Releases</CardTitle></CardHeader>
          <CardContent>
            <UpdateCenterClient
              releases={releases.map((r: any) => ({
                tagName: r.tagName,
                version: r.manifest?.version || "",
                publishedAt: r.publishedAt,
                invalidReason: r.invalidReason,
                changelog: r.manifest?.changelog || "",
                migrations: r.manifest?.migrations || [],
              }))}
              lockHeld={Boolean(updates.lockHeld)}
              configured={Boolean(updates.configured)}
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Deployment History</CardTitle></CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">No deployment attempts recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-2 pr-4">Version</th>
                    <th className="pb-2 pr-4">Status</th>
                    <th className="pb-2 pr-4">Stage</th>
                    <th className="pb-2 pr-4">Started</th>
                    <th className="pb-2 pr-4">By</th>
                    <th className="pb-2">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((d: any) => (
                    <tr key={d.id} className="border-b last:border-0">
                      <td className="py-2 pr-4 font-mono text-xs">{d.version}</td>
                      <td className="py-2 pr-4"><StatusBadge status={d.status} /></td>
                      <td className="py-2 pr-4">{d.stage || "—"}</td>
                      <td className="py-2 pr-4 text-xs text-muted-foreground">
                        {d.startedAt ? new Date(d.startedAt).toLocaleString() : "—"}
                      </td>
                      <td className="py-2 pr-4 text-xs">{d.startedBy || "—"}</td>
                      <td className="py-2 text-xs text-muted-foreground">{d.error ? String(d.error).slice(0, 120) : d.completedAt ? new Date(d.completedAt).toLocaleString() : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}