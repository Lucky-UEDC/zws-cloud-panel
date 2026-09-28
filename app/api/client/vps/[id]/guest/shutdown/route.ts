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
 * Stop the customer's server.
 *
 * Shutting down is destructive from the customer's point of view — a stopped
 * server is not reachable — so it requires an explicit confirmation in the
 * request. Not to protect the platform from the customer, but so that a
 * double-clicked button cannot take a production server offline.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await request.json().catch(() => ({}))
    assertIntentOnly(body)

    if (body.confirm !== true) {
      throw new CustomerRequestError(
        "Confirm that you want to stop this server. It will not be reachable until you start it again.",
        400,
        "CONFIRMATION_REQUIRED",
      )
    }

    const { service, vps, customerId, actor, metadata } = await requireOwnedVps(id, request)
    const running = await service.isRunning()
    if (!running) {
      return NextResponse.json({ success: true, changed: false, message: "Your server is already stopped." }, { headers: NO_STORE })
    }

    const result = await service.shutdown({ actor, metadata })
    if (!result.ok) {
      await auditCustomerChange({ vps, customerId, action: "shutdown", actor, result: { ok: false, errorCode: result.errorCode } })
      return NextResponse.json({ success: false, error: "Your server could not be stopped. It is still running." }, { status: 502, headers: NO_STORE })
    }

    await auditCustomerChange({ vps, customerId, action: "shutdown", actor, result: { upid: result.upid } })
    await notifyAfterChange(vps.id, "shutdown")
    return NextResponse.json({
      success: true,
      changed: true,
      message: "Your server is shutting down. Start it again whenever you need it.",
    }, { status: 202, headers: NO_STORE })
  } catch (error: any) {
    if (error instanceof CustomerRequestError) {
      return NextResponse.json({ success: false, error: error.message, code: error.code }, { status: error.status, headers: NO_STORE })
    }
    return NextResponse.json({ success: false, error: "Your server could not be stopped. It is still running." }, { status: 500, headers: NO_STORE })
  }
}
