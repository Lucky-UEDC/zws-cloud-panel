import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { getAdminFromCookies } from "@/lib/server-auth"
import { prisma } from "@/lib/db"
import { serializeOperatingSystem } from "./serializers"
import { canonicalOsFamily, defaultUsernameForOs, normalizeOsTemplate } from "@/lib/os-template-normalization"
import { canManageCatalog } from "@/lib/admin-rbac"
import { revalidateProductSurfaces } from "@/lib/product-revalidation"
import { syncTemplateCapability } from "@/lib/provisioning-capabilities"
import { normalizeConsoleType } from "@/lib/console-resolution"

const operatingSystemVisibilityWhere = {
  OR: [
    { source: "MANUAL" as const },
    { source: null },
    {
      AND: [{ source: "PROXMOX" as const }, { proxmoxVmid: { not: null } }],
    },
  ],
}

export async function GET(request: NextRequest) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canManageCatalog(admin.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const purpose = request.nextUrl.searchParams.get("purpose")
    const nodeId = request.nextUrl.searchParams.get("nodeId")
    const reinstallMode = purpose === "reinstall"
    const templates = await prisma.osTemplate.findMany({
      where: reinstallMode
        ? {
            isActive: true,
            reinstallEnabled: { not: false },
            source: { in: ["PROXMOX", "proxmox"] },
            proxmoxVmid: { not: null },
            ...(nodeId ? { OR: [{ proxmoxNodeId: nodeId }, { proxmoxNodeId: null }] } : {}),
          }
        : operatingSystemVisibilityWhere,
      include: {
        proxmoxNode: {
          select: {
            id: true,
            name: true,
            nodeName: true,
          },
        },
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    })

    const items = templates.map(serializeOperatingSystem).filter((template) => !reinstallMode || template.supported)
    const stats = {
      total: items.length,
      active: items.filter((template) => template.isActive).length,
      vmTemplates: items.filter((template) => template.source === "PROXMOX").length,
      manual: items.filter((template) => template.source !== "PROXMOX").length,
    }

    return NextResponse.json({ items, stats })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canManageCatalog(admin.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { name, slug, osType, isoPath, iconUrl, category, isActive, isDefault, sortOrder, osFamily, osVersion, defaultUsername, isRecommended, eolWarningText, consoleType } = body

    if (!name || !slug || !osType || !isoPath) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    // If this is set as default, unset others
    if (isDefault) {
      await prisma.osTemplate.updateMany({
        where: { isDefault: true },
        data: { isDefault: false },
      })
    }
    const normalized = normalizeOsTemplate(`${name || ""} ${slug || ""} ${osFamily || ""} ${osType || ""} ${category || ""}`)
    const canonicalFamily = canonicalOsFamily(`${name || ""} ${slug || ""} ${osFamily || ""} ${osType || ""} ${category || ""}`)
    const resolvedDefaultUsername = canonicalFamily === "windows" ? "Administrator" : String(defaultUsername || defaultUsernameForOs(canonicalFamily))

    console.log("[Admin][OsTemplate] before insert", {
      name,
      slug,
      osType,
      isoPath,
      iconUrl: iconUrl || null,
      category: category || "linux",
      isActive: isActive !== undefined ? isActive : true,
      isDefault: isDefault || false,
      sortOrder: Number(sortOrder) || 0,
      admin: admin.email,
    })

    const template = await prisma.osTemplate.create({
      data: {
        name,
        slug,
        osType,
        isoPath,
        iconUrl: iconUrl || null,
        category: category || "linux",
        isActive: isActive !== undefined ? isActive : true,
        isDefault: isDefault || false,
        sortOrder: Number(sortOrder) || 0,
        osFamily: canonicalFamily,
        osVersion: osVersion ? String(osVersion) : normalized.version,
        defaultUsername: resolvedDefaultUsername,
        isRecommended: Boolean(isRecommended),
        eolWarningText: eolWarningText ? String(eolWarningText) : null,
        consoleType: normalizeConsoleType(consoleType),
        source: "MANUAL",
        syncedFromProxmox: false,
        lastSyncedAt: null,
        proxmoxNodeId: null,
        proxmoxStorage: null,
        proxmoxVolumeId: null,
        proxmoxVmid: null,
        proxmoxTemplateName: null,
        proxmoxStatus: null,
        cpu: null,
        memoryMb: null,
        diskGb: null,
        proxmoxConfig: Prisma.JsonNull,
        format: null,
        size: null,
      },
    })
    await syncTemplateCapability(template.id)

    console.log("[Admin][OsTemplate] after insert", {
      id: template.id,
      name: template.name,
      slug: template.slug,
      admin: admin.email,
    })

    revalidateProductSurfaces()
    return NextResponse.json(serializeOperatingSystem(template))
  } catch (error: any) {
    console.error("[Admin][OsTemplate] create failed", {
      message: error?.message,
      code: error?.code,
      meta: error?.meta,
    })
    if (error.code === 'P2002') {
      return NextResponse.json({ error: "Template slug already exists" }, { status: 400 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
