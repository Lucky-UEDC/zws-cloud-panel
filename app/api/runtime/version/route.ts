import { NextResponse } from "next/server"
import { getBuildInfo } from "@/lib/build-info"

export const dynamic = "force-dynamic"
export const revalidate = 0

/**
 * Runtime version identity (Part 13). Public and safe: exposes only the
 * released version / source identifier / build time so operators and the
 * Update Center can verify exactly what is running — no internals, no secrets.
 */
export async function GET() {
  const info = getBuildInfo()
  const headers = { "Cache-Control": "no-store, no-cache, must-revalidate" }
  return NextResponse.json(
    {
      success: true,
      ...info,
    },
    { headers },
  )
}