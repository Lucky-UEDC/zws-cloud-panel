import { NextResponse } from "next/server"

export async function POST() {
  return NextResponse.json(
    {
      success: false,
      error: "The VNC-only session endpoint is deprecated. Use the unified console session endpoint.",
      endpoint: "/api/client/vps/[id]/console/session",
    },
    { status: 410 }
  )
}
