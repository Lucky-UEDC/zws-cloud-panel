import { NextRequest, NextResponse } from "next/server"
import { readUploadedFile } from "@/lib/uploads"

export const runtime = "nodejs"

const MIME_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  txt: "text/plain",
  json: "application/json",
  pdf: "application/pdf",
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params
  const urlPath = `/uploads/${slug.join("/")}`
  const file = await readUploadedFile(urlPath).catch(() => null)
  if (!file) return new NextResponse("Not Found", { status: 404 })

  const tail = slug.at(-1)?.split(".").at(-1)?.toLowerCase() || ""
  const contentType = MIME_TYPES[tail] || "application/octet-stream"

  return new NextResponse(new Uint8Array(file.bytes), {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(file.bytes.byteLength),
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  })
}