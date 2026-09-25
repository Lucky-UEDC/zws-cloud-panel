import { NextResponse } from "next/server"
import { NO_CACHE_HEADERS } from "@/lib/http-cache"
import { getRuntimeConfig } from "@/lib/runtime-config"

export const dynamic = "force-dynamic"
export const revalidate = 0

export async function GET() {
  const config = await getRuntimeConfig()
  return NextResponse.json(config, { headers: NO_CACHE_HEADERS })
}
