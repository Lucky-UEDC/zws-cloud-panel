import { NextResponse } from "next/server"
import { invalidateAuthForLogout } from "@/lib/logout"
import type { NextRequest } from "next/server"
import { createPanelLog } from "@/lib/panel-log"

export async function POST(request: NextRequest) {
  const response = NextResponse.json({ success: true })
  const result = await invalidateAuthForLogout({ request, response, adminOnly: true, endpoint: "/api/admin/auth/logout" })
  await createPanelLog({ category: "Auth", message: "manual_logout", metadata: { endpoint: "/api/admin/auth/logout", method: "POST", ...result } }).catch(() => null)

  return response
}
