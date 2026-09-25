import { NextResponse } from "next/server"
import { getClientFromCookies } from "@/lib/server-auth"
import { getClientDeploymentSnapshot } from "@/lib/client-deployments"

export const dynamic = "force-dynamic"
export const revalidate = 0

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const customer = await getClientFromCookies()
  const customerId = String(customer?.sub || "")
  if (!customerId) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  const { id } = await params
  const snapshot = await getClientDeploymentSnapshot({ id, customerId })
  if (!snapshot) return NextResponse.json({ success: false, error: "Deployment not found" }, { status: 404 })
  return NextResponse.json(snapshot)
}
