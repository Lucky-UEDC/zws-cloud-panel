"use client"

import { useEffect, useState } from "react"
import { Cloud, Link2, LogOut, RefreshCw, RotateCcw, ShieldCheck } from "lucide-react"
import { toast } from "sonner"
import { adminApiErrorMessage, adminApiJson } from "@/lib/client/admin-api"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export default function AdminCloudflarePage() {
  const [report, setReport] = useState<any>(null)
  const [dnsPlan, setDnsPlan] = useState<any>(null)
	  const [busy, setBusy] = useState("")
	  const [name, setName] = useState("myrdphub-production")
	  const [selectedAccountId, setSelectedAccountId] = useState("")
	  const [zoneId, setZoneId] = useState("")
	  const [tunnelId, setTunnelId] = useState("")
	  const [understandDnsChanges, setUnderstandDnsChanges] = useState(false)

  async function load() {
    setBusy("load")
    try {
      const data = await adminApiJson<any>("/api/admin/system/cloudflare")
	      setReport(data.report)
	      setName(data.report?.configured?.tunnelName || "myrdphub-production")
	      const activeAccount = (data.report?.configured?.accounts || []).find((account: any) => account.isActive) || data.report?.configured?.accounts?.[0] || null
	      setSelectedAccountId(activeAccount?.id || "")
	      setZoneId(activeAccount?.zoneId || data.report?.configured?.zoneId || "")
	      setTunnelId(activeAccount?.tunnelId || data.report?.configured?.tunnelId || "")
      const dns = await adminApiJson<any>("/api/admin/system/cloudflare/dns").catch(() => null)
      setDnsPlan(dns?.plan || null)
    } catch (error) {
      toast.error(adminApiErrorMessage(error, "Unable to load Cloudflare status"))
	    } finally {
	      setBusy("")
	  }
	  }

	  async function action(kind: string) {
    setBusy(kind)
    try {
      await adminApiJson("/api/admin/system/cloudflare", { method: "POST", body: JSON.stringify({ action: kind, name }) })
      toast.success(`Cloudflare ${kind} completed`)
      await load()
    } catch (error) {
      toast.error(adminApiErrorMessage(error, `Cloudflare ${kind} failed`))
    } finally {
      setBusy("")
	  }
  }

	  async function connectCloudflare() {
	    setBusy("connect")
	    try {
	      const data = await adminApiJson<any>("/api/admin/system/cloudflare/connect", { method: "POST" })
	      window.location.href = data.authorizationUrl
	    } catch (error) {
	      toast.error(adminApiErrorMessage(error, "Cloudflare connect failed"))
	      setBusy("")
	    }
	  }

	  async function selectAccount() {
	    setBusy("select")
	    try {
	      await adminApiJson("/api/admin/system/cloudflare/accounts/select", {
	        method: "POST",
	        body: JSON.stringify({ accountId: selectedAccountId, zoneId, tunnelId, tunnelName: name }),
	      })
	      toast.success("Cloudflare account selected")
	      await load()
	    } catch (error) {
	      toast.error(adminApiErrorMessage(error, "Unable to select Cloudflare account"))
	    } finally {
	      setBusy("")
	    }
	  }

	  async function disconnectCloudflare() {
	    setBusy("disconnect")
	    try {
	      await adminApiJson("/api/admin/system/cloudflare/disconnect", {
	        method: "POST",
	        body: JSON.stringify({ accountId: selectedAccountId }),
	      })
	      toast.success("Cloudflare account disconnected")
	      await load()
	    } catch (error) {
	      toast.error(adminApiErrorMessage(error, "Unable to disconnect Cloudflare account"))
	    } finally {
	      setBusy("")
	    }
	  }

  async function applyDns() {
    setBusy("dns")
    try {
      await adminApiJson("/api/admin/system/cloudflare/dns", { method: "POST", body: JSON.stringify({ understandDnsChanges }) })
      toast.success("DNS migration applied")
      setUnderstandDnsChanges(false)
      await load()
    } catch (error) {
      toast.error(adminApiErrorMessage(error, "DNS migration failed"))
    } finally {
      setBusy("")
    }
  }

  useEffect(() => { void load() }, [])

	  const tunnel = report?.tunnel || {}
	  const configured = report?.configured || {}
	  const accounts = configured.accounts || []
	  const conflicts = dnsPlan?.conflicts || []

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold">Cloudflare</h1>
          <p className="mt-1 text-muted-foreground">Tunnel status, routes, DNS migration, and direct Cloudflare mode validation.</p>
        </div>
        <Button variant="outline" onClick={load} disabled={busy === "load"} className="gap-2"><RefreshCw className="h-4 w-4" />Refresh</Button>
      </div>

	      <Card className="glass border-border/40">
	        <CardHeader><CardTitle className="flex items-center gap-2"><Cloud className="h-5 w-5" />Tunnel Manager</CardTitle><CardDescription>Create, verify, restart, and rotate the production tunnel.</CardDescription></CardHeader>
	        <CardContent className="space-y-4">
	          <div className="grid gap-3 md:grid-cols-4">
	            <Metric label="Tunnel Name" value={tunnel.name || configured.tunnelName || "-"} />
	            <Metric label="Tunnel ID" value={configured.tunnelId || tunnel.id || "-"} mono />
	            <Metric label="Status" value={report?.health?.status || tunnel.status || "unknown"} />
	            <Metric label="Source" value={configured.source || "environment"} />
	          </div>
	          <div className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto_auto_auto] lg:items-end">
	            <div className="space-y-2">
	              <Label>Account</Label>
	              <select className="h-10 rounded-md border border-input bg-background px-3 text-sm" value={selectedAccountId} onChange={(event) => {
	                const next = accounts.find((account: any) => account.id === event.target.value)
	                setSelectedAccountId(event.target.value)
	                setZoneId(next?.zoneId || "")
	                setTunnelId(next?.tunnelId || "")
	              }}>
	                <option value="">No database account</option>
	                {accounts.map((account: any) => <option key={account.id} value={account.id}>{account.accountName || account.accountId}{account.isActive ? " (active)" : ""}</option>)}
	              </select>
	            </div>
	            <div className="space-y-2">
	              <Label>Zone ID</Label>
	              <Input value={zoneId} onChange={(event) => setZoneId(event.target.value)} />
	            </div>
	            <div className="space-y-2">
	              <Label>Tunnel ID</Label>
	              <Input value={tunnelId} onChange={(event) => setTunnelId(event.target.value)} />
	            </div>
	            <Button variant="outline" onClick={connectCloudflare} disabled={Boolean(busy)} className="gap-2"><Link2 className="h-4 w-4" />Connect</Button>
	            <Button onClick={selectAccount} disabled={Boolean(busy) || !selectedAccountId}>Select</Button>
	            <Button variant="outline" onClick={disconnectCloudflare} disabled={Boolean(busy) || !selectedAccountId} className="gap-2"><LogOut className="h-4 w-4" />Disconnect</Button>
	          </div>
	          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto_auto_auto] md:items-end">
	            <div className="space-y-2">
	              <Label>Tunnel name</Label>
	              <Input value={name} onChange={(event) => setName(event.target.value)} />
	            </div>
            <Button onClick={() => action("create")} disabled={Boolean(busy)}>Create Tunnel</Button>
            <Button variant="outline" onClick={() => action("verify")} disabled={Boolean(busy)}>Verify Tunnel</Button>
            <Button variant="outline" onClick={() => action("generate-artifacts")} disabled={Boolean(busy)}>Generate Config</Button>
            <Button variant="outline" onClick={() => action("validate-direct")} disabled={Boolean(busy)}>Validate Direct</Button>
            <Button variant="outline" onClick={() => action("restart")} disabled={Boolean(busy)} className="gap-2"><RotateCcw className="h-4 w-4" />Restart</Button>
            <Button variant="outline" onClick={() => action("rotate")} disabled={Boolean(busy)}>Rotate Credentials</Button>
          </div>
        </CardContent>
      </Card>

      <Card className="glass border-border/40">
        <CardHeader><CardTitle>DNS Migration Wizard</CardTitle><CardDescription>Review current DNS, proposed tunnel routes, and conflicts before applying changes.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 lg:grid-cols-4">
            <WizardColumn title="Current DNS" rows={(dnsPlan?.current || []).map((row: any) => `${row.route.name}: ${(row.records || []).map((record: any) => `${record.type} ${record.content}`).join(", ") || "none"}`)} />
            <WizardColumn title="Tunnel Routes" rows={(dnsPlan?.proposed || []).map((row: any) => `${row.name} -> ${row.content}`)} />
            <WizardColumn title="Validation" rows={[
              `Tunnel: ${report?.ok ? "healthy" : "attention"}`,
              `Direct mode: ${report?.readiness?.ok ? "ready" : "keep nginx"}`,
              `Artifacts: ${report?.artifacts?.service || "not generated"}`,
              ...(report?.readiness?.results || []).map((row: any) => `${row.key}: ${row.ok ? "ok" : "failed"} (${row.status})`),
            ]} />
            <WizardColumn title="Apply" rows={conflicts.length ? conflicts.map((row: any) => `${row.name}: ${row.existing.type} ${row.existing.content}`) : ["No conflicts detected", "DNS records are never deleted automatically"]} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={understandDnsChanges} onChange={(event) => setUnderstandDnsChanges(event.target.checked)} />
            I understand DNS changes
          </label>
          <Button onClick={applyDns} disabled={Boolean(busy) || !understandDnsChanges || conflicts.length > 0} className="gap-2"><ShieldCheck className="h-4 w-4" />Apply DNS Migration</Button>
        </CardContent>
      </Card>
    </div>
  )
}

function Metric({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return <div className="rounded-md border border-border/40 p-3"><div className="text-xs text-muted-foreground">{label}</div><div className={mono ? "mt-1 truncate font-mono text-sm" : "mt-1 truncate text-sm font-semibold"}>{value}</div></div>
}

function WizardColumn({ title, rows }: { title: string; rows: string[] }) {
  return <div className="rounded-md border border-border/40 p-3"><div className="mb-2 flex items-center gap-2 text-sm font-medium">{title}<Badge variant="outline">{rows.length}</Badge></div><div className="space-y-2">{rows.map((row, index) => <div key={`${title}-${index}`} className="break-all rounded bg-muted/30 p-2 font-mono text-xs">{row}</div>)}</div></div>
}
