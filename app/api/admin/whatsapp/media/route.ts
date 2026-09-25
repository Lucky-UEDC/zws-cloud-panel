import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getAdminFromCookies } from "@/lib/server-auth"
import { saveWhatsAppUpload } from "@/lib/whatsapp/media"
import { jsonError, noStoreHeaders, requireWhatsAppAdmin } from "../_shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  try {
    await requireWhatsAppAdmin(request)
    const url = new URL(request.url)
    const mediaType = url.searchParams.get("mediaType")
    const assets = await (prisma as any).whatsAppMediaAsset.findMany({
      where: {
        deletedAt: null,
        ...(mediaType && mediaType !== "all" ? { mediaType } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    }).catch(() => [])
    return NextResponse.json({ ok: true, assets }, { headers: noStoreHeaders })
  } catch (error) {
    return jsonError(error)
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireWhatsAppAdmin(request)
    const admin = await getAdminFromCookies()
    const formData = await request.formData()
    const file = formData.get("file")
    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, error: "File is required" }, { status: 400, headers: noStoreHeaders })
    }
    const saved = await saveWhatsAppUpload(file, admin?.email || "server-token")
    return NextResponse.json({ ok: true, ...saved }, { headers: noStoreHeaders })
  } catch (error) {
    return jsonError(error)
  }
}
