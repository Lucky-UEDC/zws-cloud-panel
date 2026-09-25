import { mkdir, writeFile } from "node:fs/promises"
import { extname, join } from "node:path"
import crypto from "node:crypto"
import { prisma } from "@/lib/db"

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"])
const DOCUMENT_TYPES = new Set(["application/pdf"])
const AUDIO_TYPES = new Set(["audio/mpeg", "audio/mp3", "audio/ogg", "audio/webm"])
const VIDEO_TYPES = new Set(["video/mp4", "video/webm"])
const ALLOWED_TYPES = new Set([...IMAGE_TYPES, ...DOCUMENT_TYPES, ...AUDIO_TYPES, ...VIDEO_TYPES])
const STORAGE_PROVIDER = String(process.env.WHATSAPP_MEDIA_STORAGE_PROVIDER || "local").toLowerCase()

function safeExtension(file: File) {
  const original = file.name ? extname(file.name).toLowerCase() : ""
  if (original && /^[a-z0-9.]+$/i.test(original)) return original
  if (file.type === "application/pdf") return ".pdf"
  if (file.type === "image/png") return ".png"
  if (file.type === "image/webp") return ".webp"
  if (file.type === "video/mp4") return ".mp4"
  if (file.type === "audio/ogg") return ".ogg"
  return ".bin"
}

export function classifyWhatsAppMedia(mime: string) {
  if (IMAGE_TYPES.has(mime)) return "image"
  if (DOCUMENT_TYPES.has(mime)) return "document"
  if (AUDIO_TYPES.has(mime)) return "audio"
  if (VIDEO_TYPES.has(mime)) return "video"
  return "document"
}

export type WhatsAppMediaOptimizationDecision = {
  supported: boolean
  shouldOptimize: boolean
  reason: string
  maxBytes: number
}

export function mediaOptimizationDecision(input: { mimeType: string; size: number }): WhatsAppMediaOptimizationDecision {
  const mediaType = classifyWhatsAppMedia(input.mimeType)
  const maxBytes = mediaType === "image" ? 5 * 1024 * 1024 : mediaType === "video" ? 16 * 1024 * 1024 : 100 * 1024 * 1024
  if (!ALLOWED_TYPES.has(input.mimeType)) return { supported: false, shouldOptimize: false, reason: "unsupported_type", maxBytes }
  if (input.size > maxBytes) return { supported: false, shouldOptimize: false, reason: "too_large", maxBytes }
  if (mediaType === "image" && input.size > 1_200_000) return { supported: true, shouldOptimize: true, reason: "image_size_threshold", maxBytes }
  return { supported: true, shouldOptimize: false, reason: "within_limits", maxBytes }
}

function readUInt24BE(buffer: Buffer, offset: number) {
  return (buffer[offset] << 16) + (buffer[offset + 1] << 8) + buffer[offset + 2]
}

export function readImageDimensions(buffer: Buffer, mimeType: string): { width?: number; height?: number } {
  if (mimeType === "image/png" && buffer.length >= 24 && buffer.toString("ascii", 1, 4) === "PNG") {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
  }
  if ((mimeType === "image/jpeg" || mimeType === "image/jpg") && buffer.length > 4) {
    let offset = 2
    while (offset < buffer.length) {
      if (buffer[offset] !== 0xff) break
      const marker = buffer[offset + 1]
      const length = buffer.readUInt16BE(offset + 2)
      if (marker >= 0xc0 && marker <= 0xc3 && offset + 8 < buffer.length) {
        return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) }
      }
      offset += 2 + length
    }
  }
  if (mimeType === "image/webp" && buffer.length >= 30 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
    const chunk = buffer.toString("ascii", 12, 16)
    if (chunk === "VP8X" && buffer.length >= 30) {
      return { width: 1 + readUInt24BE(buffer, 24), height: 1 + readUInt24BE(buffer, 27) }
    }
  }
  return {}
}

export async function saveWhatsAppUpload(file: File, uploadedBy?: string | null) {
  if (!ALLOWED_TYPES.has(file.type)) {
    throw new Error("Unsupported media type. Upload JPG, PNG, WEBP, MP4, PDF, or supported audio files only.")
  }

  const mediaType = classifyWhatsAppMedia(file.type)
  const decision = mediaOptimizationDecision({ mimeType: file.type, size: file.size })
  if (!decision.supported) {
    if (decision.reason === "too_large") {
      throw new Error(mediaType === "image" ? "Images must be 5MB or smaller." : mediaType === "video" ? "Videos must be 16MB or smaller." : "Documents must be 100MB or smaller.")
    }
    throw new Error("Unsupported WhatsApp media type.")
  }

  const uploadDir = join(process.cwd(), "public", "uploads", "whatsapp")
  await mkdir(uploadDir, { recursive: true })
  const filename = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${safeExtension(file)}`
  const bytes = Buffer.from(await file.arrayBuffer())
  const filePath = join(uploadDir, filename)
  await writeFile(filePath, bytes)
  const dimensions = mediaType === "image" ? readImageDimensions(bytes, file.type) : {}
  const checksum = crypto.createHash("sha256").update(bytes).digest("hex")
  const publicUrl = `/uploads/whatsapp/${filename}`

  const asset = await (prisma as any).whatsAppMediaAsset.create({
    data: {
      id: `wa_media_${crypto.randomUUID()}`,
      mediaType,
      originalName: file.name || filename,
      optimizedName: decision.shouldOptimize ? filename : null,
      mimeType: file.type,
      size: file.size,
      width: dimensions.width || null,
      height: dimensions.height || null,
      storageProvider: STORAGE_PROVIDER || "local",
      storagePath: filePath,
      publicUrl,
      thumbnailPath: mediaType === "image" ? publicUrl : null,
      uploadedBy: uploadedBy || null,
      checksum,
      optimization: {
        decision: decision.reason,
        optimized: false,
        note: decision.shouldOptimize
          ? "Optimization is queued/adapter-ready; original file retained for provider-safe delivery."
          : "No optimization needed.",
      },
    },
  }).catch(() => null)

  return {
    id: asset?.id || null,
    asset,
    url: publicUrl,
    filePath,
    mediaType,
    mimeType: file.type,
    size: file.size,
    width: dimensions.width || null,
    height: dimensions.height || null,
    storageProvider: STORAGE_PROVIDER || "local",
    storagePath: filePath,
    thumbnailPath: mediaType === "image" ? publicUrl : null,
    optimization: decision,
  }
}

export function publicUrlToLocalPath(url: string) {
  if (!url.startsWith("/uploads/whatsapp/")) throw new Error("Unsupported WhatsApp media path.")
  return join(process.cwd(), "public", url)
}
