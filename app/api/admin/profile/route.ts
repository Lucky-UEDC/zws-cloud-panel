import { NextRequest, NextResponse } from "next/server"
import { getAdminFromCookies } from "@/lib/server-auth"
import { prisma } from "@/lib/db"

export async function PUT(request: NextRequest) {
  const admin = await getAdminFromCookies()
  if (!admin?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = (await request.json()) as { displayName?: string; email?: string }
  const email = String(body.email || "").trim().toLowerCase()
  const displayName = String(body.displayName || "").trim()

  if (!email || !displayName) {
    return NextResponse.json({ error: "Name and email are required" }, { status: 400 })
  }

  const current = await prisma.adminProfile.findUnique({ where: { email: String(admin.email).toLowerCase() } })
  if (!current) {
    return NextResponse.json({ error: "Admin not found" }, { status: 404 })
  }

  const updated = await prisma.adminProfile.update({
    where: { id: current.id },
    data: { email, displayName, username: email.split("@")[0] },
  })

  return NextResponse.json({ success: true, user: { email: updated.email, displayName: updated.displayName } })
}
