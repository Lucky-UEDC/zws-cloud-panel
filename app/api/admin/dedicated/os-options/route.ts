import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getAdminFromCookies } from "@/lib/server-auth"
import { ensureDefaultDedicatedOsOptions } from "@/lib/dedicated"

export async function GET() {
  const admin = await getAdminFromCookies()
  if (!admin?.email) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  await ensureDefaultDedicatedOsOptions()
  const options = await prisma.dedicatedOsOption.findMany({ orderBy: [{ sortOrder: "asc" }, { familyLabel: "asc" }, { name: "asc" }] })
  return NextResponse.json({ success: true, options })
}

export async function POST(request: NextRequest) {
  const admin = await getAdminFromCookies()
  if (!admin?.email) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  const body = await request.json().catch(() => ({}))
  const name = String(body.name || "").trim()
  const familyLabel = String(body.familyLabel || body.family || "").trim()
  if (!name || !familyLabel) return NextResponse.json({ success: false, error: "Name and family are required." }, { status: 400 })
  const slug = String(body.slug || `${familyLabel}-${name}`).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
  const option = await prisma.dedicatedOsOption.create({
    data: {
      name,
      slug,
      family: String(body.family || familyLabel).toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      familyLabel,
      version: body.version ? String(body.version) : null,
      iconUrl: body.iconUrl ? String(body.iconUrl) : null,
      description: body.description ? String(body.description) : null,
      defaultUsername: body.defaultUsername ? String(body.defaultUsername) : null,
      isActive: body.isActive !== false,
      isRecommended: Boolean(body.isRecommended),
      sortOrder: Number(body.sortOrder || 0),
    },
  })
  return NextResponse.json({ success: true, option }, { status: 201 })
}
