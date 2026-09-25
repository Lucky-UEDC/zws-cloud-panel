import { NextRequest, NextResponse } from "next/server"
import { getClientFromCookies } from "@/lib/server-auth"
import { resolveOperationProgress } from "@/lib/operation-progress"

export const dynamic = "force-dynamic"
export const revalidate = 0

export async function GET(_request: NextRequest, { params }: { params: Promise<{ operationId: string }> }) {
  const customer = await getClientFromCookies()
  const customerId = String(customer?.sub || "")
  if (!customerId) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })

  const { operationId } = await params

  const operation = await resolveOperationProgress(operationId)
  if (!operation) return NextResponse.json({ success: false, error: "Operation not found" }, { status: 404 })
  if (String(operation.customerId) !== String(customerId)) {
    return NextResponse.json({ success: false, error: "Operation not found" }, { status: 404 })
  }

  return NextResponse.json({
    success: true,
    operation: {
      operationId: operation.operationId,
      kind: operation.kind,
      vpsInstanceId: operation.vpsInstanceId,
      status: operation.status,
      headline: operation.headline,
      startedAt: operation.startedAt,
      finishedAt: operation.finishedAt || null,
      percent: operation.percent,
      phase: operation.phase,
      transferredBytes: operation.transferredBytes,
      totalBytes: operation.totalBytes,
      transferredLabel: operation.transferredLabel,
      totalLabel: operation.totalLabel,
      speedLabel: operation.speedLabel,
      elapsedSeconds: operation.elapsedSeconds,
      logTail: operation.logTail || [],
      verified: operation.verified,
      error: operation.error || null,
      result: operation.result || null,
    },
  })
}