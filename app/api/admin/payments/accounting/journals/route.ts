import { NextRequest, NextResponse } from "next/server"
import { canManagePaymentGateways } from "@/lib/admin-rbac"
import { getAdminFromCookies } from "@/lib/server-auth"
import { prisma } from "@/lib/db"

function csv(value: unknown) { return `"${String(value ?? "").replace(/"/g, '""')}"` }

export async function GET(request: NextRequest) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canManagePaymentGateways(admin.role)) return NextResponse.json({ success: false, code: "unauthorized", error: "Unauthorized" }, { status: 401 })
  const journals = await (prisma as any).accountingJournal.findMany({ orderBy: { effectiveAt: "desc" }, take: Math.min(5000, Number(request.nextUrl.searchParams.get("limit") || 1000)), include: { entries: { include: { account: true } } } })
  if (request.nextUrl.searchParams.get("format") === "csv") {
    const lines = [["journal_id", "effective_at", "event_type", "source_type", "source_id", "currency", "account_code", "account_name", "direction", "amount"].map(csv).join(",")]
    for (const journal of journals) for (const entry of journal.entries) lines.push([journal.id, journal.effectiveAt.toISOString(), journal.eventType, journal.sourceType, journal.sourceId, journal.currency, entry.account.code, entry.account.name, entry.direction, entry.amount].map(csv).join(","))
    return new NextResponse(lines.join("\n"), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": "attachment; filename=payment-journals.csv" } })
  }
  return NextResponse.json({ success: true, journals })
}
