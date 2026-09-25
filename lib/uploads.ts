import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join, normalize, relative, resolve, sep } from "node:path"

export function uploadRoot() {
  return String(process.env.ZWS_UPLOAD_DIR || "").trim() || join(process.cwd(), "public", "uploads")
}

export function sanitizeUploadName(name: string) {
  const cleaned = String(name || "file")
    .trim()
    .replace(/\.[^.]+$/, (match) => /^[a-zA-Z0-9]{1,8}$/.test(match.slice(1)) ? match : "")
  return cleaned.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 120) || "file"
}

export async function saveUpload(subdir: string, bytes: Uint8Array, proposedName: string) {
  const dir = join(uploadRoot(), subdir)
  await mkdir(dir, { recursive: true })
  const name = sanitizeUploadName(proposedName)
  const fsPath = join(dir, name)
  await writeFile(fsPath, bytes)
  return { url: `/uploads/${subdir}/${name}`, fsPath }
}

export async function readUploadedFile(urlPath: string) {
  const resolved = resolveUploadedFile(urlPath)
  if (!resolved) return null
  const bytes = await readFile(resolved)
  return { bytes, fsPath: resolved }
}

export function resolveUploadedFile(urlPath: string) {
  const raw = String(urlPath || "")
  if (!raw.startsWith("/uploads/")) return null
  const root = resolve(uploadRoot())
  let target: string
  try {
    target = resolve(root, normalize(decodeURIComponent(raw.replace(/^\/uploads\//, ""))))
  } catch {
    return null
  }
  const relativePath = relative(root, target)
  if (!relativePath || relativePath.startsWith(`..${sep}`) || relativePath.includes(`..${sep}`) || target === root) return null
  if (relativePath.includes("\0")) return null
  return target
}