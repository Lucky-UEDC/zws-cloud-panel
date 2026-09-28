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

const ACTIONS = ["create", "disable", "enable", "delete"] as const
type UserAction = (typeof ACTIONS)[number]

/**
 * Manage the accounts on the customer's own server.
 *
 * "Create a user", "disable a user" — intent, resolved to the right OS command
 * here. Four actions, and the shape of each request is validated up front so a
 * typo produces a sentence rather than a shell error.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await request.json().catch(() => ({}))
    assertIntentOnly(body)

    const action = String(body.action || "") as UserAction
    if (!ACTIONS.includes(action)) {
      throw new CustomerRequestError(`Choose one of: ${ACTIONS.join(", ")}.`, 400, "INVALID_ACTION")
    }
    const username = parseUsername(body.username)
    const password = action === "create" ? parsePassword(body.password) : null

    const { service, vps, customerId, actor, metadata } = await requireOwnedVps(id, request)
    const primary = vps.adminUsername || vps.username || "root"
    if (username.toLowerCase() === String(primary).toLowerCase()) {
      throw new CustomerRequestError("That is the account you sign in with, so it cannot be changed here. Use the password page instead.", 409, "PRIMARY_ACCOUNT")
    }

    // Named per action rather than a single "userAction" flag, so a plan can
    // never half-apply a lifecycle change or apply the wrong one.
    const desired = action === "create"
      ? { createUser: { username, password } }
      : action === "delete"
        ? { deleteUser: username }
        : action === "disable"
          ? { disableUser: username }
          : { enableUser: username }

    const result = await service.applyChange({ desired: desired as any, actor, metadata })
    if ("message" in result) {
      const failure = guestFailureToResponse(result.errorCode, result.message)
      await auditCustomerChange({ vps, customerId, action: `user:${action}`, actor, result: { username, errorCode: result.errorCode } })
      return NextResponse.json(failure.body, { status: failure.status, headers: NO_STORE })
    }

    await auditCustomerChange({ vps, customerId, action: `user:${action}`, actor, result: { username, runId: result.runId, status: result.status } })
    await notifyAfterChange(vps.id, "users")
    return NextResponse.json({
      success: true,
      ...publicRunResult(result as any),
      username,
      message: {
        create: "The account has been created.",
        disable: "The account has been disabled.",
        enable: "The account has been enabled.",
        delete: "The account has been deleted.",
      }[action],
    }, { headers: NO_STORE })
  } catch (error: any) {
    if (error instanceof CustomerRequestError) {
      return NextResponse.json({ success: false, error: error.message, code: error.code }, { status: error.status, headers: NO_STORE })
    }
    return NextResponse.json({ success: false, error: "That account change could not be applied." }, { status: 500, headers: NO_STORE })
  }
}
