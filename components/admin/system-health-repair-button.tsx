"use client"

import { useState } from "react"
import { Wrench } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { readJsonResponse } from "@/lib/client/safe-json"

export function SystemHealthRepairButton() {
  const [busy, setBusy] = useState(false)

  async function repair() {
    setBusy(true)
    try {
      const response = await fetch("/api/admin/system/health/repair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 50 }),
      })
      const body = await readJsonResponse<any>(response)
      if (!response.ok && response.status !== 207) throw new Error(body?.error || "Platform repair failed")
      const result = body?.result || {}
      toast.success(`Repair complete: ${result.repaired || 0} repaired, ${result.skipped || 0} skipped, ${result.failed || 0} failed`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Platform repair failed")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button type="button" variant="outline" onClick={repair} disabled={busy} className="gap-2">
      <Wrench className="h-4 w-4" />
      {busy ? "Repairing..." : "Repair"}
    </Button>
  )
}
