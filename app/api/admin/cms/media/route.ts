import { parse } from "node:path"
import crypto from "node:crypto"
import sharp from "sharp"
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { slugify } from "@/lib/cms"
import { requireCmsAdmin } from "../_auth"
import { saveUpload } from "@/lib/uploads"

export const runtime = "nodejs"

export async function GET() {
  const { response } = await requireCmsAdmin()
  if (response) return response
  const assets = await (prisma as any).cmsMediaAsset.findMany({ where: { deletedAt: null }, orderBy: { createdAt: "desc" }, take: 100 }).catch(() => [])
  return NextResponse.json({ ok: true, assets })
}

export async function POST(request: NextRequest) {
  const { admin, response } = await requireCmsAdmin()
  if (response) return response
  const formData = await request.formData()
  const file = formData.get("file")
  const altText = String(formData.get("altText") || "")
  if (!(file instanceof File)) return NextResponse.json({ ok: false, error: "File is required" }, { status: 400 })
  if (!file.type.startsWith("image/")) return NextResponse.json({ ok: false, error: "Only image uploads are supported" }, { status: 400 })
  const buffer = Buffer.from(await file.arrayBuffer())
  const hash = crypto.createHash("sha256").update(buffer).digest("hex")
  const base = slugify(parse(file.name).name)
  const optimizedName = `${base}-${hash.slice(0, 10)}.webp`
  const image = sharp(buffer).rotate()
  const metadata = await image.metadata()
  const output = await image.webp({ quality: 82 }).toBuffer()
  const { url, fsPath } = await saveUpload("cms", output, optimizedName)
  const asset = await (prisma as any).cmsMediaAsset.create({
    data: {
      mediaType: "image",
      originalName: file.name,
      optimizedName,
      mimeType: "image/webp",
      size: output.length,
      width: metadata.width || null,
      height: metadata.height || null,
      storagePath: fsPath,
      publicUrl: url,
      altText,
      uploadedBy: String(admin?.email || ""),
      checksum: hash,
      optimization: { sourceMimeType: file.type, originalSize: file.size, convertedTo: "webp" },
    },
  })
  return NextResponse.json({ ok: true, asset })
}

export async function PATCH(request: NextRequest) {
  const { response } = await requireCmsAdmin()
  if (response) return response
  const body = await request.json().catch(() => ({}))
  const id = String(body.id || "")
  if (!id) return NextResponse.json({ ok: false, error: "Media asset is required" }, { status: 400 })
  const asset = await (prisma as any).cmsMediaAsset.update({
    where: { id },
    data: { altText: body.altText == null ? null : String(body.altText) },
  }).catch(() => null)
  if (!asset) return NextResponse.json({ ok: false, error: "Media asset not found" }, { status: 404 })
  return NextResponse.json({ ok: true, asset })
}

export async function DELETE(request: NextRequest) {
  const { response } = await requireCmsAdmin()
  if (response) return response
  const id = String(request.nextUrl.searchParams.get("id") || "")
  if (!id) return NextResponse.json({ ok: false, error: "Media asset is required" }, { status: 400 })
  await (prisma as any).cmsMediaAsset.update({ where: { id }, data: { deletedAt: new Date() } }).catch(() => null)
  return NextResponse.json({ ok: true })
}
