import fs from "node:fs/promises"
import path from "node:path"

export async function appendRuntimeLog(fileName: "whatsapp.log" | "mfa.log" | "otp.log", event: string, metadata: Record<string, unknown> = {}) {
  const logDir = process.env.ZWS_LOG_DIR || path.join(process.cwd(), "logs")
  await fs.mkdir(logDir, { recursive: true }).catch(() => null)
  const line = JSON.stringify({ at: new Date().toISOString(), event, ...metadata })
  await fs.appendFile(path.join(logDir, fileName), `${line}\n`).catch(() => null)
}
