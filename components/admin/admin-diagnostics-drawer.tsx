"use client"

import { useCallback, useEffect, useState } from "react"
import { AlertTriangle, RefreshCw } from "lucide-react"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { readJsonResponse } from "@/lib/client/safe-json"
import { dedupedAdminErrorToast } from "@/lib/client/admin-toast"

type ConsistencyResponse = {
  success: boolean
  consistency?: {
    checkedAt: string
    issues: {
      paidWithoutService: number
      vmWithoutProvisioningLink: number
      ipOwnershipMismatch: number
      activeInvoiceMismatch: number
      orphanProvisioningJobs: number
      orphanVms: number
    }
    totals: {
      ordersScanned: number
      vmRows: number
    }
    samples: {
      paidWithoutServiceOrderIds: string[]
      vmWithoutProvisioningOrderIds: string[]
      ipMismatchOrderIds: string[]
    }
  }
  diagnosticsSummary?: {
    rowsWithIssues: number
    staleVmStates: number
    networkMismatch: number
    provisioningFailed: number
    paymentFailed: number
  }
  degraded?: {
    degradedMode: boolean
    degradedReasons: string[]
  }
  startupSchema?: {
    ok: boolean
    checkedAt: string
    missingTables: string[]
    pendingMigrations: string[]
    failedMigrations: string[]
    pendingDeploy: boolean
    degradedFeatures: string[]
    failedStartupChecks: string[]
  }
  error?: string
}

type PaymentHealthResponse = {
  success: boolean
  cards?: {
    failedWebhooks?: number
    pendingPayments?: number
    stuckPayments?: number
    failedProvisioningTriggers?: number
  }
}

export function AdminDiagnosticsDrawer(props: {
  triggerLabel?: string
  localFailures: string[]
  consistencyEndpoint?: string
  onRetry?: () => Promise<void> | void
}) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [payload, setPayload] = useState<ConsistencyResponse | null>(null)
  const [paymentHealth, setPaymentHealth] = useState<PaymentHealthResponse | null>(null)

  const loadDiagnostics = useCallback(async () => {
    setLoading(true)
    try {
      const [consistencyResponse, paymentResponse] = await Promise.all([
        fetch(props.consistencyEndpoint || "/api/admin/consistency/vm-orders", { cache: "no-store" }),
        fetch("/api/admin/payments/health", { cache: "no-store" }).catch(() => null),
      ])
      const body = (await readJsonResponse<ConsistencyResponse>(consistencyResponse)) || { success: false }
      if (!consistencyResponse.ok || !body.success) throw new Error(body.error || "Unable to load diagnostics")
      setPayload(body)
      if (paymentResponse?.ok) {
        const paymentBody = await readJsonResponse<PaymentHealthResponse>(paymentResponse)
        setPaymentHealth(paymentBody || null)
      }
    } catch (error: any) {
      dedupedAdminErrorToast({ message: error?.message || "Unable to load diagnostics" })
    } finally {
      setLoading(false)
    }
  }, [props.consistencyEndpoint])

  useEffect(() => {
    if (!open) return
    void loadDiagnostics()
  }, [loadDiagnostics, open])

  const issues = payload?.consistency?.issues || null
  const summary = payload?.diagnosticsSummary || null
  const startupSchema = payload?.startupSchema || null
  const degraded = payload?.degraded || null

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button size="sm" variant="outline" className="gap-2">
          <AlertTriangle className="h-4 w-4" />
          {props.triggerLabel || "Diagnostics"}
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Admin Diagnostics</SheetTitle>
          <SheetDescription>
            Consistency checks, stale state hints, and recoverable failures.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 px-4 pb-4">
          <div className="flex items-center justify-between">
            <Badge variant="secondary">{loading ? "Refreshing" : "Latest snapshot"}</Badge>
            <Button size="sm" variant="outline" className="gap-2" onClick={() => void loadDiagnostics()}>
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </Button>
          </div>

          <section className="rounded-md border border-border/50 p-3 space-y-2">
            <h3 className="text-sm font-medium">API Failures</h3>
            {props.localFailures.length ? (
              <ul className="space-y-1 text-sm">
                {props.localFailures.map((failure, index) => (
                  <li key={`${failure}-${index}`} className="text-destructive">{failure}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No API failures captured on this screen.</p>
            )}
            {props.onRetry ? (
              <Button size="sm" variant="outline" onClick={() => void props.onRetry?.()}>Retry current view</Button>
            ) : null}
          </section>

          <section className="rounded-md border border-border/50 p-3 space-y-2">
            <h3 className="text-sm font-medium">Consistency Checks</h3>
            {issues ? (
              <div className="grid grid-cols-2 gap-2 text-sm">
                <Metric label="Paid without service" value={issues.paidWithoutService} />
                <Metric label="VM without provisioning" value={issues.vmWithoutProvisioningLink} />
                <Metric label="IP ownership mismatch" value={issues.ipOwnershipMismatch} />
                <Metric label="Paid invoice mismatch" value={issues.activeInvoiceMismatch} />
                <Metric label="Orphan provisioning" value={issues.orphanProvisioningJobs} />
                <Metric label="Orphan VM" value={issues.orphanVms} />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Diagnostics are unavailable.</p>
            )}
          </section>

          <section className="rounded-md border border-border/50 p-3 space-y-2">
            <h3 className="text-sm font-medium">Platform Health Summary</h3>
            {summary ? (
              <div className="grid grid-cols-2 gap-2 text-sm">
                <Metric label="Rows with issues" value={summary.rowsWithIssues} />
                <Metric label="Stale VM states" value={summary.staleVmStates} />
                <Metric label="Network mismatch" value={summary.networkMismatch} />
                <Metric label="Provision failed" value={summary.provisioningFailed} />
                <Metric label="Payment failed" value={summary.paymentFailed} />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Summary unavailable.</p>
            )}
          </section>

          <section className="rounded-md border border-border/50 p-3 space-y-2">
            <h3 className="text-sm font-medium">Startup Schema and Migration Status</h3>
            {startupSchema ? (
              <div className="space-y-2 text-sm">
                <p className={startupSchema.ok ? "text-emerald-600" : "text-amber-600"}>
                  {startupSchema.ok ? "Healthy" : "Degraded mode active"}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <Metric label="Missing tables" value={startupSchema.missingTables.length} />
                  <Metric label="Pending migrations" value={startupSchema.pendingMigrations.length} />
                  <Metric label="Failed migrations" value={startupSchema.failedMigrations.length} />
                  <Metric label="Failed startup checks" value={startupSchema.failedStartupChecks.length} />
                </div>
                {degraded?.degradedMode ? (
                  <p className="text-xs text-muted-foreground">
                    Degraded features: {(startupSchema.degradedFeatures || []).join(", ") || "none"}
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Startup schema checks unavailable.</p>
            )}
          </section>

          <section className="rounded-md border border-border/50 p-3 space-y-2">
            <h3 className="text-sm font-medium">Webhook and Payment Signals</h3>
            {paymentHealth?.cards ? (
              <div className="grid grid-cols-2 gap-2 text-sm">
                <Metric label="Webhook failures" value={Number(paymentHealth.cards.failedWebhooks || 0)} />
                <Metric label="Pending payments" value={Number(paymentHealth.cards.pendingPayments || 0)} />
                <Metric label="Stuck payments" value={Number(paymentHealth.cards.stuckPayments || 0)} />
                <Metric label="Provision triggers failed" value={Number(paymentHealth.cards.failedProvisioningTriggers || 0)} />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Payment health unavailable.</p>
            )}
          </section>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border border-border/40 px-2 py-1">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="text-sm font-medium">{Number(value || 0).toLocaleString()}</p>
    </div>
  )
}
