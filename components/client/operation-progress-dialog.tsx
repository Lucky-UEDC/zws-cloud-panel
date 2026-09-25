"use client"

import { useOperationProgress, formatElapsed, type OperationView } from "@/lib/client/use-operation-progress"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Progress } from "@/components/ui/progress"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Loader2 } from "lucide-react"

export function OperationProgressDialog({
  operationId,
  onClose,
  onComplete,
  title,
  open = true,
}: {
  operationId: string
  onClose: () => void
  onComplete?: (operation: OperationView) => void
  title?: string
  open?: boolean
}) {
  const { operation, terminal } = useOperationProgress(operationId)
  const completed = operation?.status === "completed" && operation.verified !== false

  if (typeof window !== "undefined" && terminal && operation?.status === "completed") {
    onComplete?.(operation)
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {!terminal ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {title || operation?.headline || "Operation in progress"}
          </DialogTitle>
          <DialogDescription>
            {operation?.headline && operation.headline !== title ? operation.headline : null}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{operation?.phase || "Running"}</span>
              <span className="flex items-center gap-2">
                {operation?.percent != null ? <span className="font-semibold">{Math.round(operation.percent)}%</span> : <Badge variant="outline">Running</Badge>}
                <span className="text-xs text-muted-foreground">{formatElapsed(operation?.elapsedSeconds)}</span>
              </span>
            </div>
            {operation?.percent != null ? (
              <Progress value={Math.max(0, Math.min(100, operation.percent))} className="mt-2 h-2.5" />
            ) : (
              <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-border/40">
                <div className="h-full w-2/5 animate-[operation-indeterminate_1.2s_ease-in-out_infinite] rounded-full bg-primary" />
              </div>
            )}
            {operation?.transferredLabel || operation?.totalLabel ? (
              <div className="mt-2 text-xs text-muted-foreground">
                {[operation?.transferredLabel, operation?.totalLabel].filter(Boolean).join(" of ")}
                {operation?.speedLabel ? ` · ${operation.speedLabel}` : ""}
              </div>
            ) : null}
          </div>

          {operation?.logTail?.length ? (
            <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-border/40 bg-background/40 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
              {operation.logTail.slice(-15).map((line, index) => (
                <div key={index} className="truncate">{line}</div>
              ))}
            </div>
          ) : null}

          {operation?.status === "completed" ? (
            <div className="rounded-md border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-sm text-emerald-200">Completed successfully.</div>
          ) : operation?.status === "failed" || operation?.status === "timedout" ? (
            <div className="rounded-md border border-red-400/30 bg-red-400/10 px-3 py-2 text-sm text-red-200">{operation?.error || "Operation failed"}</div>
          ) : operation?.status === "gone" ? (
            <div className="rounded-md border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-sm text-amber-200">Operation detail expired; check the resulting list to confirm the outcome.</div>
          ) : null}
        </div>

        <DialogFooter>
          {completed ? (
            <Button onClick={onClose}>Done</Button>
          ) : (
            <Button variant="outline" onClick={onClose} disabled={!terminal}>Close</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}