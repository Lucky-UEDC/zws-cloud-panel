import { NextRequest } from "next/server"
import { GET as geoGet } from "@/app/api/geo/route"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export function GET(request: NextRequest) {
  return geoGet(request)
}
