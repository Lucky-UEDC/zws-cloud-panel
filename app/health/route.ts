import { NextResponse } from "next/server"
import { NO_CACHE_HEADERS } from "@/lib/http-cache"

export const dynamic = "force-dynamic"
export const revalidate = 0

export function GET() {
  return NextResponse.json({ status: "ok" }, { headers: NO_CACHE_HEADERS })
}
