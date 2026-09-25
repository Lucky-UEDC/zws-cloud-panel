import { appendFile, mkdir } from "node:fs/promises"
import path from "node:path"
import { randomUUID } from "node:crypto"

export type StructuredLogFile =
  | "customer-page"
  | "proxmox-sync"
  | "vm-actions"
  | "api-errors"

const FILES: Record<StructuredLogFile, string> = {
  "customer-page": "customer-page.log",
  "proxmox-sync": "proxmox-sync.log",
  "vm-actions": "vm-actions.log",
  "api-errors": "api-errors.log",
}

function logDir() {
  return process.env.ZWS_LOG_DIR || path.join(process.env.ZWS_ROOT_DIR || process.cwd(), "logs")
}

function normalizeError(error: unknown) {
  if (!error) return null
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: process.env.NODE_ENV === "production" ? undefined : error.stack,
    }
  }
  if (typeof error === "object") {
    const record = error as Record<string, unknown>
    return {
      name: String(record.name || "Error"),
      message: String(record.message || JSON.stringify(record)),
      status: record.status || record.statusCode || record.httpStatus || null,
      code: record.code || null,
    }
  }
  return { name: "Error", message: String(error) }
}

export function requestId(prefix = "req") {
  return `${prefix}_${randomUUID()}`
}

export async function writeStructuredLog(file: StructuredLogFile, event: string, fields: Record<string, unknown> = {}) {
  const dir = logDir()
  const line = JSON.stringify({
    at: new Date().toISOString(),
    event,
    ...fields,
    error: normalizeError(fields.error),
  })
  try {
    await mkdir(dir, { recursive: true })
    await appendFile(path.join(dir, FILES[file]), `${line}\n`, "utf8")
  } catch (error) {
    console.warn("[structured-log] write_failed", {
      file,
      event,
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

export async function logApiError(fields: Record<string, unknown>) {
  await writeStructuredLog("api-errors", "api_error", fields)
}
