import { NextResponse } from "next/server"

export async function GET() {
  return NextResponse.json(
    {
      success: false,
      error: "Direct VNC ticket endpoints are disabled. Use the unified console session endpoint.",
      endpoint: "/api/client/vps/[id]/console/session",
    },
    { status: 405 }
  )
}
