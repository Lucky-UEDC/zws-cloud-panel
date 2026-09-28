import { NextRequest, NextResponse } from "next/server"
import {
  assertIntentOnly,
  auditCustomerChange,
  CustomerRequestError,
  guestFailureToResponse,
  NO_STORE,
  notifyAfterChange,
  parseIpv4,
  parsePrefix,
  parseDnsList,
  parsePassword,
  parseUsername,
  publicRunResult,
  requireOwnedVps,
} from "../_shared"

export const dynamic = "force-dynamic"
export const revalidate = 0

/**
 * Change the address of the customer's own server.
 *
 * The request is an address and a subnet. Which tool sets it — `ip`, `nmcli`,
 * `netsh`, PowerShell — is decided here from the OS the guest reports, and is
 * never taken from the request.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let subject: Awaited<ReturnType<typeof requireOwnedVps>> | null = null
  try {
    const { id } = await params
    const body = await request.json().catch(() => ({}))
    assertIntentOnly(body)

    const ip = parseIpv4(body.ip ?? body.address, "The IP address")
    const prefix = parsePrefix(body.prefix ?? body.cidr)
    const gateway = parseIpv4(body.gateway, "The gateway")
    const dns = body.dns === undefined ? undefined : parseDnsList(body.dns)

    subject = await requireOwnedVps(id, request)
    const { service, vps, customerId, actor, metadata } = subject

    const result = await service.applyChange({
      desired: { ip, prefix, gateway, dns },
      actor,
      metadata,
    })
    if ("message" in result) {
      const failure = guestFailureToResponse(result.errorCode, result.message)
      await auditCustomerChange({ vps, customerId, action: "network", actor, result: { errorCode: result.errorCode } })
      return NextResponse.json(failure.body, { status: failure.status, headers: NO_STORE })
    }

    await auditCustomerChange({ vps, customerId, action: "network", actor, result: { runId: result.runId, status: result.status, os: result.detected.osId } })
    await notifyAfterChange(vps.id, "network")
    return NextResponse.json({
      success: true,
      ...publicRunResult(result as any),
      // Spelled out because "no change" is a success, not a failure, and a
      // customer who asked for what they already had deserves to be told that
      // rather than shown a red error.
      message: result.status === "success" && result.steps.every((step) => !step.changed)
        ? "Your server already has that address. Nothing was changed."
        : "Your server has been re-addressed.",
      // The guest may need a moment to release the old address and take the new
      // one. Saying so up front is better than a customer who sees a dropped
      // connection and assumes the change broke something.
      note: "Your connection may drop for a few seconds while the new address is applied.",
    }, { headers: NO_STORE })
  } catch (error: any) {
    if (error instanceof CustomerRequestError) {
      return NextResponse.json({ success: false, error: error.message, code: error.code }, { status: error.status, headers: NO_STORE })
    }
    return NextResponse.json({ success: false, error: "The address could not be changed. Nothing was modified." }, { status: 500, headers: NO_STORE })
  }
}
