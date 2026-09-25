import { NextResponse } from "next/server"
import { getPublicTurnstileConfig } from "@/lib/security/security-settings"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const config = await getPublicTurnstileConfig().catch(() => ({
    enabled: false,
    siteKey: "",
    mode: "managed" as const,
    protect: {
      login: true,
      signup: true,
      register: true,
      forgotPassword: true,
      contact: true,
      checkout: true,
      tickets: true,
      support: true,
      orders: true,
      adminLogin: true,
    },
  }))
  return NextResponse.json(config, {
    headers: {
      "Cache-Control": "no-store",
    },
  })
}
