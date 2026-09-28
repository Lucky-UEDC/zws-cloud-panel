import { NextRequest, NextResponse } from "next/server"
import {
  assertIntentOnly,
  auditCustomerChange,
  CustomerRequestError,
  guestFailureToResponse,
  NO_STORE,
  notifyAfterChange,
  parsePassword,
  parseUsername,
  publicRunResult,
  requireOwnedVps,
} from "../_shared"

export const dynamic = "force-dynamic"
export const revalidate = 0

/**
 * Reset the login password on the customer's own server.
 *
 * The password is validated, passed to the guest over the guest agent's stdin
 * channel, and then dropped. It is never written into a command line, never
 * logged, and never returned. The template reads it from stdin and pipes it to
 * `chpasswd` or `Set-LocalUser`, so the value does not appear in the guest's
 * process list either.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await request.json().catch(() => ({}))
    assertIntentOnly(body)

    const password = parsePassword(body.password)
    // Which account is being changed is a real decision, so it is an explicit
    // field with a sane default rather than anything the request can smuggle in.
    const requested = body.username ? parseUsername(body.username) : null

    const { service, vps, customerId, actor, metadata } = await requireOwnedVps(id, request)
    const username = requested || vps.adminUsername || vps.username || "root"
    if (requested && requested.toLowerCase() !== String(username).toLowerCase()) {
      return NextResponse.json(
        { success: false, error: `You can only reset the password for the account on this server (${username}).` },
        { status: 403, headers: NO_STORE },
      )
    }

    const result = await service.setPassword({ username, password, actor, metadata })
    if (!result.ok) {
      const failure = guestFailureToResponse(result.errorCode)
      await auditCustomerChange({ vps, customerId, action: "password", actor, result: { username, errorCode: result.errorCode } })
      return NextResponse.json(failure.body, { status: failure.status, headers: NO_STORE })
    }

    // Only the username is recorded. Not the password, not a hash of it, not a
    // length. A log that says which account was reset is useful; one that says
    // anything about the value is a liability.
    await auditCustomerChange({ vps, customerId, action: "password", actor, result: { username, runId: result.runId, status: result.status } })
    await notifyAfterChange(vps.id, "password")
    return NextResponse.json({
      success: true,
      ...publicRunResult(result as any),
      username,
      message: "The password for this server has been changed.",
    }, { headers: NO_STORE })
  } catch (error: any) {
    if (error instanceof CustomerRequestError) {
      return NextResponse.json({ success: false, error: error.message, code: error.code }, { status: error.status, headers: NO_STORE })
    }
    return NextResponse.json({ success: false, error: "The password could not be changed." }, { status: 500, headers: NO_STORE })
  }
}
