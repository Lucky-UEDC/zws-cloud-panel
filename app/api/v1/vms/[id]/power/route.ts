import { NextRequest, NextResponse } from "next/server"
import { authenticateApiKey, requireScope, apiError } from "@/lib/api/auth"
import { performVpsPowerAction } from "@/lib/vps-control"

export const dynamic = "force-dynamic"

const ALLOWED = ["start", "stop", "reboot", "forceStop"] as const

// POST /api/v1/vms/{id}/power  { "action": "start|stop|reboot|forceStop" }
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await authenticateApiKey(req)
  if ("error" in auth) return auth.error
  const scopeErr = requireScope(auth.ctx, "vm:write")
  if (scopeErr) return scopeErr

  const body = await req.json().catch(() => ({}))
  const action = String(body?.action || "")
  if (!ALLOWED.includes(action as any)) {
    return apiError("invalid_action", `action must be one of: ${ALLOWED.join(", ")}`, 400)
  }

  try {
    const result: any = await performVpsPowerAction({
      vpsId: id,
      action: action as (typeof ALLOWED)[number],
      // client keys are hard-scoped to their own customer; reseller keys are unrestricted.
      customerId: auth.ctx.type === "client" ? auth.ctx.ownerCustomerId || "__none__" : undefined,
      requestedBy: `api-key:${auth.ctx.id}`,
      requestedRole: "api_key",
    })
    return NextResponse.json({
      data: {
        action,
        status: result?.status || "accepted",
        runtimeStatus: result?.runtimeStatus || null,
        vpsInstanceId: result?.vpsInstanceId || id,
        proxmoxNodeId: result?.proxmoxNodeId || null,
        node: result?.node || null,
        vmid: result?.vmid || null,
        taskId: result?.taskId || null,
      },
    }, { status: 202 })
  } catch (error: any) {
    return apiError(error?.code || "action_failed", error?.message || "Power action failed", Number(error?.status) || 500)
  }
}
