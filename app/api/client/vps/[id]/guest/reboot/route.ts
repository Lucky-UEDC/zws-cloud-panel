import { NextRequest, NextResponse } from "next/server"
import {
  assertIntentOnly,
  auditCustomerChange,
  CustomerRequestError,
  NO_STORE,
  notifyAfterChange,
  requireOwnedVps,
} from "../_shared"

export const dynamic = "force-dynamic"
export const revalidate = 0

/**
 * Restart the customer's server.
 *
 * The Proxmox API does this, not the guest. Asking a guest to shut itself down
 * is strictly worse: if the command never lands, the server is up and the
 * customer was told it was restarting. The host can guarantee it.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await request.json().catch(() => ({}))
    assertIntentOnly(body)

    const { service, vps, customerId, actor, metadata } = await requireOwnedVps(id, request)
    const running = await service.isRunning()
    if (!running) {
      return NextResponse.json({
        success: true,
        changed: false,
        message: "Your server is already stopped, so nothing was restarted.",
      }, { headers: NO_STORE })
    }

    const result = await service.reboot({ actor, metadata })
    if (!result.ok) {
      await auditCustomerChange({ vps, customerId, action: "reboot", actor, result: { ok: false, errorCode: result.errorCode } })
      return NextResponse.json({ success: false, error: "Your server could not be restarted. It is still running." }, { status: 502, headers: NO_STORE })
    }

    await auditCustomerChange({ vps, customerId, action: "reboot", actor, result: { upid: result.upid } })
    await notifyAfterChange(vps.id, "reboot")
    return NextResponse.json({
      success: true,
      changed: true,
      message: "Your server is restarting. It will be back in a minute or two.",
    }, { status: 202, headers: NO_STORE })
  } catch (error: any) {
    if (error instanceof CustomerRequestError) {
      return NextResponse.json({ success: false, error: error.message, code: error.code }, { status: error.status, headers: NO_STORE })
    }
    return NextResponse.json({ success: false, error: "Your server could not be restarted. It is still running." }, { status: 500, headers: NO_STORE })
  }
}
