import { NextRequest, NextResponse } from "next/server"
import { getAdminFromCookies } from "@/lib/server-auth"
import { getVncEnvDebug, runVncDiagnostics } from "@/lib/vnc-diagnostics"

export async function GET(request: NextRequest) {
  const admin = await getAdminFromCookies()
  if (!admin) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  }

  const vmid = Number(request.nextUrl.searchParams.get("vmid"))
  const node = String(request.nextUrl.searchParams.get("node") || "")
  const env = getVncEnvDebug()

  if (!Number.isInteger(vmid) || !node.trim()) {
    return NextResponse.json({ success: false, error: "vmid and node are required", steps: [], env }, { status: 400 })
  }

  const result = await runVncDiagnostics({ vmid, node })
  return NextResponse.json(result, { status: result.success ? 200 : 500 })
}
