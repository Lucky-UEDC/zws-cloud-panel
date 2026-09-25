import { NextRequest, NextResponse } from "next/server"
import { randomUUID } from "node:crypto"
import { getAdminFromCookies } from "@/lib/server-auth"
import { canManagePaymentGateways } from "@/lib/admin-rbac"
import { createPanelLog } from "@/lib/panel-log"
import { saveUpload } from "@/lib/uploads"

const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/svg+xml"])
const MAX_SIZE = 5 * 1024 * 1024

function hasSignature(bytes: Buffer, magic: number[]) {
  if (bytes.length < magic.length) return false
  return magic.every((value, index) => bytes[index] === value)
}

function detectImageKind(bytes: Buffer): "png" | "jpeg" | "webp" | "svg" | "unknown" {
  if (hasSignature(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png"
  if (hasSignature(bytes, [0xff, 0xd8, 0xff])) return "jpeg"
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "webp"
  const preview = bytes.subarray(0, Math.min(bytes.length, 512)).toString("utf8")
  if (/<svg[\s>]/i.test(preview)) return "svg"
  return "unknown"
}

function svgLooksSafe(bytes: Buffer) {
  const text = bytes.toString("utf8")
  if (/<\s*(script|foreignObject)\b/i.test(text)) return false
  if (/\bon(afterprint|beforeprint|beforeunload|error|hashchange|load|pageshow|popstate|resize|scroll|storage|unload|animation\w*|transition\w*|click|mouse\w*|dblclick|focus|blur|key\w*|input|change|submit|drag\w*|drop|contextmenu|paste|cut|copy)\s*=/i.test(text)) return false
  return true
}

function extFor(kind: "png" | "jpeg" | "webp" | "svg") {
  if (kind === "jpeg") return "jpg"
  return kind
}

export async function POST(request: NextRequest) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canManagePaymentGateways(admin.role)) {
    return NextResponse.json({ ok: false, code: "forbidden", message: "You do not have permission to manage payment gateways." }, { status: 403 })
  }

  const formData = await request.formData().catch(() => null)
  const file = formData?.get("logo")

  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, code: "file_required", message: "An image file is required." }, { status: 400 })
  }

  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json({ ok: false, code: "unsupported_file_type", message: "Unsupported file type. Allowed: PNG, JPG, WEBP, SVG." }, { status: 400 })
  }

  if (file.size > MAX_SIZE) {
    return NextResponse.json({ ok: false, code: "file_too_large", message: "Logo must be 5 MB or smaller." }, { status: 400 })
  }

  const bytes = Buffer.from(await file.arrayBuffer())
  const kind = detectImageKind(bytes)
  if (kind === "unknown") {
    return NextResponse.json({ ok: false, code: "invalid_image", message: "File content does not match a supported image format." }, { status: 400 })
  }
  if (kind === "svg" && !svgLooksSafe(bytes)) {
    return NextResponse.json({ ok: false, code: "unsafe_svg", message: "SVG logos may not contain scripts or event handlers." }, { status: 400 })
  }

  const safeName = `gateway-logo-${randomUUID()}.${extFor(kind)}`
  const { url } = await saveUpload("gateway-logos", bytes, safeName)

  await createPanelLog({
    category: "PAYMENT",
    message: "payment_gateway_logo_uploaded",
    actorType: "admin",
    actorEmail: String(admin.email),
    metadata: { logoUrl: url, provider: null },
  }).catch(() => null)

  return NextResponse.json({ ok: true, success: true, logoUrl: url })
}