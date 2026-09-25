import { NextResponse } from "next/server"
import { requireAdminOperation } from "@/lib/admin-auth"
import { getAdminDashboardData } from "@/lib/admin-dashboard"

export async function GET() {
  const { response } = await requireAdminOperation()
  if (response) return response

  try {
    return NextResponse.json(await getAdminDashboardData())
  } catch {
    return NextResponse.json({ error: "Failed to fetch dashboard data" }, { status: 500 })
  }
}
