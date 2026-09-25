import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getAdminFromCookies } from "@/lib/server-auth"

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  const { id } = await params
  const body = await request.json().catch(() => ({}))
  const option = await prisma.dedicatedOsOption.update({
    where: { id },
    data: {
      name: body.name === undefined ? undefined : String(body.name),
      family: body.family === undefined ? undefined : String(body.family),
      familyLabel: body.familyLabel === undefined ? undefined : String(body.familyLabel),
      version: body.version === undefined ? undefined : body.version ? String(body.version) : null,
      iconUrl: body.iconUrl === undefined ? undefined : body.iconUrl ? String(body.iconUrl) : null,
      description: body.description === undefined ? undefined : body.description ? String(body.description) : null,
      defaultUsername: body.defaultUsername === undefined ? undefined : body.defaultUsername ? String(body.defaultUsername) : null,
      isActive: body.isActive === undefined ? undefined : Boolean(body.isActive),
      isRecommended: body.isRecommended === undefined ? undefined : Boolean(body.isRecommended),
      sortOrder: body.sortOrder === undefined ? undefined : Number(body.sortOrder || 0),
    },
  })
  return NextResponse.json({ success: true, option })
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  const { id } = await params
  const linkedServices = await prisma.dedicatedService.count({ where: { dedicatedOsOptionId: id } }).catch(() => 0)
  if (linkedServices > 0) {
    const option = await prisma.dedicatedOsOption.update({
      where: { id },
      data: { isActive: false },
    })
    return NextResponse.json({
      success: true,
      deleted: false,
      option,
      message: "Option is used by existing services, so it was disabled instead.",
    })
  }
  await prisma.dedicatedOsOption.delete({ where: { id } })
  return NextResponse.json({ success: true, deleted: true })
}
