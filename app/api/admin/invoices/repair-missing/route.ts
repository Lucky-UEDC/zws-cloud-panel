import { NextResponse } from "next/server"
import { getAdminFromCookies } from "@/lib/server-auth"
import { repairMissingInvoices } from "@/lib/invoices"
import { canAccessAdminApi } from "@/lib/admin-rbac"

export async function POST() {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const result = await repairMissingInvoices()
  return NextResponse.json({ success: true, result })
}
