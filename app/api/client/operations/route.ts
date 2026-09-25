import { NextRequest, NextResponse } from "next/server"
import { getClientFromCookies } from "@/lib/server-auth"
import { getOperationsForVps } from "@/lib/operation-progress"

export const dynamic = "force-dynamic"
export const revalidate = 0

export async function GET(request: NextRequest) {
  const customer = await getClientFromCookies()
  const customerId = String(customer?.sub || "")
  if (!customerId) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })

  const url = new URL(request.url)
  const vpsInstanceId = url.searchParams.get("vpsInstanceId") || ""

  const all = (vpsInstanceId ? getOperationsForVps(vpsInstanceId) : [])
    .filter((operation) => String(operation.customerId) === String(customerId))
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())

  return NextResponse.json({
    success: true,
    operations: all.map((operation) => ({
      operationId: operation.operationId,
      kind: operation.kind,
      vpsInstanceId: operation.vpsInstanceId,
      status: operation.status,
      headline: operation.headline,
      startedAt: operation.startedAt,
      finishedAt: operation.finishedAt || null,
      percent: operation.percent,
      phase: operation.phase,
      transferredLabel: operation.transferredLabel,
      totalLabel: operation.totalLabel,
      speedLabel: operation.speedLabel,
      elapsedSeconds: operation.elapsedSeconds,
      verified: operation.verified,
      error: operation.error || null,
    })),
  })
}