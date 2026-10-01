import { NextRequest, NextResponse } from "next/server"
import { guestFailureToResponse, requireOwnedVps, NO_STORE, CustomerRequestError } from "../_shared"

export const dynamic = "force-dynamic"
export const revalidate = 0

/**
 * What the customer's server is, as the guest itself reports it.
 *
 * The answer is the guest's, not the panel's. When the guest agent does not
 * answer, this says so plainly rather than falling back to what the panel
 * believes it configured — a panel belief is not evidence that anything is
 * actually running.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { vps, service, metadata } = await requireOwnedVps(id, request)

    const [detected, capabilities, state] = await Promise.all([
      service.detectOs(metadata),
      service.getCapabilities(),
      service.detectOs(metadata).then((value) => (value.kind === "unknown" ? null : service.getState(value.engine))),
    ])

    if (detected.kind === "unknown") {
      return NextResponse.json({
        success: true,
        // `false` rather than an error: nothing is wrong, the guest simply
        // cannot be asked, and the customer should be told which.
        guestAgentReachable: false,
        managed: false,
        message: "Your server is not reporting its configuration, so it cannot be changed from this page. If it has just started, wait a minute and refresh.",
        server: {
          id: vps.id,
          name: vps.name,
          hostname: vps.hostname,
          ipAddress: vps.ipAddress,
          username: vps.username || vps.adminUsername,
          status: String(vps.status || "").toLowerCase(),
        },
      }, { headers: NO_STORE })
    }

    return NextResponse.json({
      success: true,
      guestAgentReachable: true,
      managed: capabilities.automationSupported,
      os: {
        id: detected.osId,
        name: detected.name,
        version: detected.version,
        // A coarse engine label the customer can act on ("Linux", "Windows")
        // rather than the internal lowercase token.
        family: detected.engine === "windows" ? "Windows" : "Linux",
      },
      capabilities: {
        canChangeAddress: capabilities.automationSupported,
        canChangePassword: capabilities.automationSupported,
        canManageUsers: capabilities.automationSupported && capabilities.supportedOperations.includes("create_user"),
        canReboot: true,
        canShutdown: true,
      },
      // The values the guest reports, so the page shows the truth rather than
      // what was last requested.
      network: {
        hostname: state?.hostname || null,
        primaryInterface: state?.primaryInterface || null,
        addresses: state?.ipv4 || [],
      },
      server: {
        id: vps.id,
        name: vps.name,
        ipAddress: vps.ipAddress,
        username: vps.username || vps.adminUsername,
        status: String(vps.status || "").toLowerCase(),
      },
      unavailable: capabilities.automationSupported ? null : guestFailureToResponse("UNSUPPORTED_OPERATION").body.error,
    }, { headers: NO_STORE })
  } catch (error: any) {
    if (error instanceof CustomerRequestError) {
      return NextResponse.json({ success: false, error: error.message, code: error.code }, { status: error.status, headers: NO_STORE })
    }
    return NextResponse.json({ success: false, error: "Could not read your server's status." }, { status: 500, headers: NO_STORE })
  }
}
