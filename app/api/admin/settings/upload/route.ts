import { NextRequest, NextResponse } from "next/server"
import { randomUUID } from "node:crypto"
import { getAdminFromCookies } from "@/lib/server-auth"
import { canManageSettings } from "@/lib/admin-rbac"
import { saveUpload } from "@/lib/uploads"

const ALLOWED = new Set(["image/png", "image/jpeg", "image/webp", "image/x-icon", "image/vnd.microsoft.icon"])
const MAX_SIZE = 2 * 1024 * 1024
const TARGETS = new Set(["logo", "favicon", "footer-logo", "invoice-logo", "open-graph"])

export async function POST(request: NextRequest) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canManageSettings(admin.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const formData = await request.formData()
  const target = String(formData.get("target") || "logo")
  const file = formData.get("file")

  if (!TARGETS.has(target)) {
    return NextResponse.json({ error: "Unsupported branding target" }, { status: 400 })
  }

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "File is required" }, { status: 400 })
  }

  if (!ALLOWED.has(file.type)) {
    return NextResponse.json({ error: "Unsupported file type" }, { status: 400 })
  }

  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: "File too large" }, { status: 400 })
  }

  const bytes = Buffer.from(await file.arrayBuffer())
  const ext = file.name.includes(".") ? file.name.split(".").pop() : "png"
  const safeName = `${target}-${randomUUID()}.${ext}`

  const { url } = await saveUpload("branding", bytes, safeName)
  return NextResponse.json({ success: true, url })
}