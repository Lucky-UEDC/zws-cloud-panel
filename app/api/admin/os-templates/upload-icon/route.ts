import { randomUUID } from "node:crypto"
import { NextRequest, NextResponse } from "next/server"
import { getAdminFromCookies } from "@/lib/server-auth"
import { canManageCatalog } from "@/lib/admin-rbac"
import { saveUpload } from "@/lib/uploads"

const ALLOWED_TYPES = new Set(["image/png", "image/svg+xml", "image/webp", "image/jpeg"])
const MAX_SIZE = 2 * 1024 * 1024

export async function POST(request: NextRequest) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canManageCatalog(admin.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const formData = await request.formData()
  const file = formData.get("file")

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "File is required" }, { status: 400 })
  }

  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json({ error: "Unsupported file type" }, { status: 400 })
  }

  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: "File too large" }, { status: 400 })
  }

  const bytes = Buffer.from(await file.arrayBuffer())
  const ext = extensionFor(file)
  const safeName = `os-icon-${randomUUID()}.${ext}`

  const { url } = await saveUpload("os-icons", bytes, safeName)
  return NextResponse.json({ success: true, url })
}

function extensionFor(file: File) {
  const fromName = file.name.includes(".") ? file.name.split(".").pop()?.toLowerCase() : ""
  if (fromName && /^[a-z0-9]+$/.test(fromName)) return fromName
  if (file.type === "image/svg+xml") return "svg"
  if (file.type === "image/webp") return "webp"
  if (file.type === "image/jpeg") return "jpg"
  return "png"
}