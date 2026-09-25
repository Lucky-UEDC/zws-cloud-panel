import crypto from "node:crypto"
import { execFile } from "node:child_process"
import { createReadStream } from "node:fs"
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { prisma } from "@/lib/db"
import { getServiceIntegrationConfig } from "@/lib/integration-config"
import { escapeSerializable } from "@/lib/security/input"

const execFileAsync = promisify(execFile)
const MAX_ATTACHMENT_BYTES = Number(process.env.TICKET_ATTACHMENT_MAX_BYTES || 25 * 1024 * 1024)
const LOCAL_ROOT = process.env.TICKET_ATTACHMENT_DIR || path.join(process.env.ZWS_SHARED_DIR || process.cwd(), "uploads", "ticket-attachments")
const ALLOWED_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf", "text/plain", "application/zip", "application/octet-stream"])
const ALLOWED_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".pdf", ".txt", ".log", ".zip"])

type Owner = { customerId?: string | null; adminId?: string | null }
type StoredFile = {
  originalName: string
  mimeType: string
  sizeBytes: number
  checksumSha256: string
  storageProvider: string
  storageKey: string
}

function safeName(name: string) {
  const base = path.basename(String(name || "attachment")).replace(/[^\w.\- ]+/g, "_").trim()
  return base || "attachment"
}

function digest(buffer: Buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex")
}

function publicAttachment(attachment: any) {
  const mimeType = String(attachment.mimeType || "application/octet-stream")
  return {
    id: attachment.id,
    name: attachment.originalName,
    mimeType,
    sizeBytes: Number(attachment.sizeBytes || 0),
    createdAt: attachment.createdAt?.toISOString?.() || attachment.createdAt,
    url: `/api/tickets/attachments/${encodeURIComponent(attachment.id)}`,
    previewUrl: mimeType.startsWith("image/")
      ? `/api/tickets/attachments/${encodeURIComponent(attachment.id)}?preview=1`
      : null,
  }
}

export function serializeTicketMessage(message: any) {
  return escapeSerializable({
    ...message,
    attachments: Array.isArray(message.attachments) ? message.attachments.map(publicAttachment) : [],
  })
}

export function serializeTicket(ticket: any) {
  return escapeSerializable({
    ...ticket,
    messages: Array.isArray(ticket.messages) ? ticket.messages.map(serializeTicketMessage) : ticket.messages,
  })
}

async function rcloneAttachmentConfig() {
  const config = await getServiceIntegrationConfig("googleDriveAttachmentStorage").catch(() => ({} as Record<string, unknown>))
  const enabled = config.enabled === true || String(config.enabled || "").toLowerCase() === "true" || process.env.GDRIVE_ATTACHMENT_STORAGE_ENABLED === "1"
  const remote = String(config.rcloneRemote || process.env.GDRIVE_ATTACHMENT_RCLONE_REMOTE || "").trim()
  const folder = String(config.driveFolder || process.env.GDRIVE_ATTACHMENT_FOLDER || "ZWS Ticket Attachments").trim()
  const sharedDrive = String(config.sharedDrive || process.env.GDRIVE_ATTACHMENT_SHARED_DRIVE || "").trim()
  return { enabled, remote, folder, sharedDrive }
}

async function storeLocal(buffer: Buffer, originalName: string): Promise<StoredFile> {
  const checksumSha256 = digest(buffer)
  const date = new Date()
  const yyyy = String(date.getUTCFullYear())
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0")
  const dd = String(date.getUTCDate()).padStart(2, "0")
  const id = crypto.randomBytes(18).toString("base64url")
  const key = `${yyyy}/${mm}/${dd}/${id}-${safeName(originalName)}`
  const target = path.join(LOCAL_ROOT, key)
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, buffer, { mode: 0o600 })
  return {
    originalName: safeName(originalName),
    mimeType: "application/octet-stream",
    sizeBytes: buffer.length,
    checksumSha256,
    storageProvider: "local",
    storageKey: key,
  }
}

async function storeRclone(buffer: Buffer, originalName: string, contentType: string): Promise<StoredFile | null> {
  const config = await rcloneAttachmentConfig()
  if (!config.enabled || !config.remote) return null
  const tmp = path.join(os.tmpdir(), `zws-ticket-${crypto.randomBytes(12).toString("hex")}-${safeName(originalName)}`)
  await writeFile(tmp, buffer, { mode: 0o600 })
  try {
    const date = new Date()
    const yyyy = String(date.getUTCFullYear())
    const mm = String(date.getUTCMonth() + 1).padStart(2, "0")
    const dd = String(date.getUTCDate()).padStart(2, "0")
    const id = crypto.randomBytes(18).toString("base64url")
    const remoteKey = `${config.folder.replace(/^\/+|\/+$/g, "")}/${yyyy}/${mm}/${dd}/${id}-${safeName(originalName)}`
    const remotePath = `${config.remote.replace(/\/+$/g, "")}/${remoteKey}`
    const args = ["copyto", tmp, remotePath]
    if (config.sharedDrive) args.push("--drive-shared-with-me")
    await execFileAsync("rclone", args, { maxBuffer: 1024 * 1024 * 5 })
    return {
      originalName: safeName(originalName),
      mimeType: contentType || "application/octet-stream",
      sizeBytes: buffer.length,
      checksumSha256: digest(buffer),
      storageProvider: "rclone",
      storageKey: remoteKey,
    }
  } finally {
    await rm(tmp, { force: true }).catch(() => undefined)
  }
}

export async function storeTicketFile(file: File): Promise<StoredFile> {
  const bytes = Buffer.from(await file.arrayBuffer())
  if (!bytes.length) throw new Error("Attachment is empty.")
  if (bytes.length > MAX_ATTACHMENT_BYTES) throw new Error(`Attachment exceeds ${Math.round(MAX_ATTACHMENT_BYTES / 1024 / 1024)} MB.`)
  const name = safeName(file.name)
  const mimeType = String(file.type || "application/octet-stream")
  const ext = path.extname(name).toLowerCase()
  if (!ALLOWED_EXTENSIONS.has(ext)) throw new Error("Attachment type is not allowed.")
  if (mimeType !== "application/octet-stream" && !ALLOWED_MIME_TYPES.has(mimeType)) throw new Error("Attachment type is not allowed.")
  const remote = await storeRclone(bytes, name, mimeType).catch((error) => {
    console.warn("[ticket_attachment_rclone_fallback]", error?.message || String(error))
    return null
  })
  if (remote) return remote
  const local = await storeLocal(bytes, name)
  return { ...local, mimeType }
}

export async function attachFilesToMessage(input: {
  ticketId: string
  messageId: string
  files: File[]
  owner: Owner
}) {
  const files = input.files.filter((file) => file && Number(file.size || 0) > 0)
  if (!files.length) return []
  const rows = []
  for (const file of files) {
    const stored = await storeTicketFile(file)
    rows.push(await (prisma as any).supportTicketAttachment.create({
      data: {
        ticketId: input.ticketId,
        messageId: input.messageId,
        customerId: input.owner.customerId || null,
        adminId: input.owner.adminId || null,
        originalName: stored.originalName,
        mimeType: stored.mimeType,
        sizeBytes: stored.sizeBytes,
        checksumSha256: stored.checksumSha256,
        storageProvider: stored.storageProvider,
        storageKey: stored.storageKey,
        metadata: {},
      },
    }))
  }
  return rows
}

export async function parseTicketBody(request: Request) {
  const contentType = request.headers.get("content-type") || ""
  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData()
    const files = form.getAll("attachments").filter((value): value is File => typeof value === "object" && "arrayBuffer" in value)
    return {
      subject: String(form.get("subject") || ""),
      message: String(form.get("message") || form.get("body") || ""),
      category: String(form.get("category") || ""),
      priority: String(form.get("priority") || ""),
      productId: String(form.get("productId") || ""),
      internalOnly: String(form.get("internalOnly") || "").toLowerCase() === "true",
      status: String(form.get("status") || ""),
      assignedAdminId: String(form.get("assignedAdminId") || ""),
      turnstileToken: String(form.get("turnstileToken") || ""),
      files,
    }
  }
  const body = await request.json().catch(() => ({} as any))
  return {
    subject: String(body.subject || ""),
    message: String(body.message || body.body || ""),
    category: String(body.category || ""),
    priority: String(body.priority || ""),
    productId: String(body.productId || ""),
    internalOnly: Boolean(body.internalOnly),
    status: String(body.status || ""),
    assignedAdminId: String(body.assignedAdminId || ""),
    turnstileToken: String(body.turnstileToken || ""),
    files: [] as File[],
  }
}

async function attachmentLocalPath(attachment: any) {
  return path.join(LOCAL_ROOT, String(attachment.storageKey || ""))
}

async function attachmentRclonePath(attachment: any) {
  const config = await rcloneAttachmentConfig()
  if (!config.remote) throw new Error("Attachment storage is unavailable.")
  return `${config.remote.replace(/\/+$/g, "")}/${String(attachment.storageKey || "").replace(/^\/+/g, "")}`
}

export async function openAttachmentStream(attachment: any) {
  if (attachment.storageProvider === "rclone") {
    const tmp = path.join(os.tmpdir(), `zws-ticket-download-${crypto.randomBytes(12).toString("hex")}`)
    await execFileAsync("rclone", ["copyto", await attachmentRclonePath(attachment), tmp], { maxBuffer: 1024 * 1024 * 5 })
    const info = await stat(tmp)
    return { stream: createReadStream(tmp), size: info.size, cleanup: () => rm(tmp, { force: true }).catch(() => undefined) }
  }
  const filePath = await attachmentLocalPath(attachment)
  if (!filePath.startsWith(path.resolve(LOCAL_ROOT))) throw new Error("Invalid attachment key.")
  const info = await stat(filePath)
  return { stream: createReadStream(filePath), size: info.size, cleanup: () => Promise.resolve() }
}

export async function readAttachmentBytesForTest(attachment: any) {
  if (attachment.storageProvider !== "local") return null
  return readFile(await attachmentLocalPath(attachment))
}
