import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getAdminFromCookies } from "@/lib/server-auth"
import { isAdminLikeRole } from "@/lib/admin-rbac"

function csvEscape(value: unknown) {
  const text = String(value ?? "")
  if (/[,"\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

export async function GET(request: NextRequest) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !isAdminLikeRole(admin.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const url = new URL(request.url)
  const customerId = url.searchParams.get("customerId") || undefined
  const action = url.searchParams.get("action") || undefined
  const adminId = url.searchParams.get("adminId") || undefined
  const format = url.searchParams.get("format") || "json"
  const from = url.searchParams.get("from")
  const to = url.searchParams.get("to")

  const logs = await prisma.auditLog.findMany({
    where: {
      customerId,
      adminId,
      action,
      createdAt: {
        gte: from ? new Date(from) : undefined,
        lte: to ? new Date(to) : undefined,
      },
    },
    orderBy: { createdAt: "desc" },
    take: 500,
  })

  if (format === "csv") {
    const header = ["createdAt", "adminId", "customerId", "action", "oldValue", "newValue", "ipAddress", "userAgent"]
    const rows = logs.map((log) =>
      [
        log.createdAt.toISOString(),
        log.adminId,
        log.customerId || "",
        log.action,
        log.oldValue || "",
        log.newValue || "",
        log.ipAddress || "",
        log.userAgent || "",
      ]
        .map(csvEscape)
        .join(","),
    )

    const csv = [header.join(","), ...rows].join("\n")
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": "attachment; filename=audit-log.csv",
      },
    })
  }

  return NextResponse.json({ logs })
}
