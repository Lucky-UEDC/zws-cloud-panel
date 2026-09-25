import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { getAdminFromCookies } from "@/lib/server-auth"
import { prisma } from "@/lib/db"
import { serializeOperatingSystem } from "../serializers"
import { canonicalOsFamily, defaultUsernameForOs, normalizeOsTemplate } from "@/lib/os-template-normalization"
import { canManageCatalog } from "@/lib/admin-rbac"
import { revalidateProductSurfaces } from "@/lib/product-revalidation"
import { syncTemplateCapability } from "@/lib/provisioning-capabilities"
import { normalizeConsoleType } from "@/lib/console-resolution"

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canManageCatalog(admin.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  try {
    const template = await prisma.osTemplate.findUnique({
      where: { id },
      include: {
        proxmoxNode: {
          select: {
            id: true,
            name: true,
            nodeName: true,
          },
        },
      },
    })
    if (!template) return NextResponse.json({ error: "Template not found" }, { status: 404 })
    return NextResponse.json(serializeOperatingSystem(template))
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canManageCatalog(admin.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  try {
    const body = await request.json()
    const { isDefault } = body
    const existing = await prisma.osTemplate.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 })
    }

    if (isDefault) {
      await prisma.osTemplate.updateMany({
        where: { isDefault: true },
        data: { isDefault: false },
      })
    }

    const normalized = normalizeOsTemplate(`${body.name || existing.name || ""} ${body.slug || existing.slug || ""} ${body.osFamily || existing.osFamily || ""} ${body.osType || existing.osType || ""} ${body.category || existing.category || ""}`)
    const canonicalFamily = canonicalOsFamily(`${body.name || existing.name || ""} ${body.slug || existing.slug || ""} ${body.osFamily || existing.osFamily || ""} ${body.osType || existing.osType || ""} ${body.category || existing.category || ""}`)
    const patch: Record<string, unknown> = {
      ...body,
      iconUrl: body.iconUrl || null,
      osFamily: canonicalFamily,
      osVersion: body.osVersion || normalized.version || null,
      defaultUsername: canonicalFamily === "windows" ? "Administrator" : body.defaultUsername || defaultUsernameForOs(canonicalFamily),
      isRecommended: Boolean(body.isRecommended),
      eolWarningText: body.eolWarningText || null,
      consoleType: normalizeConsoleType(body.consoleType ?? existing.consoleType),
      sortOrder: Number(body.sortOrder || 0),
    }

    if (existing.source === "MANUAL") {
      patch.source = "MANUAL"
      patch.syncedFromProxmox = false
      patch.lastSyncedAt = null
      patch.proxmoxNodeId = null
      patch.proxmoxVmid = null
      patch.proxmoxTemplateName = null
      patch.proxmoxStatus = null
      patch.cpu = null
      patch.memoryMb = null
      patch.diskGb = null
      patch.proxmoxStorage = null
      patch.proxmoxVolumeId = null
      patch.proxmoxConfig = Prisma.JsonNull
      patch.format = null
      patch.size = null
    }

    const template = await prisma.osTemplate.update({
      where: { id },
      data: patch,
    })
    await syncTemplateCapability(template.id)
    revalidateProductSurfaces()
    return NextResponse.json(serializeOperatingSystem(template))
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canManageCatalog(admin.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  try {
    await prisma.osTemplate.delete({ where: { id } })
    revalidateProductSurfaces()
    return NextResponse.json({ success: true })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
