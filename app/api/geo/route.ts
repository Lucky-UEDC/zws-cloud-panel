import { NextRequest, NextResponse } from "next/server"
import { resolveLocation } from "@/lib/geo/resolve-location"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const location = await resolveLocation(request.headers, { debug: true })
  return NextResponse.json(location, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  })
}
