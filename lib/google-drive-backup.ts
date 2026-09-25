import crypto from "node:crypto"
import os from "node:os"
import path from "node:path"
import { promises as fs } from "node:fs"
import { getRuntimeIntegrationConfig, getServiceIntegrationConfig, updateRuntimeIntegrationConfig } from "@/lib/integration-config"
import { prisma } from "@/lib/db"
import { googleDriveCallbackUrl } from "@/lib/auth/google-oauth"
import { requireSecret } from "@/lib/security/env-secret"

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
const DRIVE_API = "https://www.googleapis.com/drive/v3"
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3"
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file"

function text(value: unknown) {
  return String(value || "").trim()
}

function oauthSecret() {
  return requireSecret(["NEXTAUTH_SECRET", "SESSION_SECRET", "JWT_SECRET"], "zws-drive-oauth")
}

function hmac(value: string) {
  return crypto.createHmac("sha256", oauthSecret()).update(value).digest("base64url")
}

function base64url(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64url")
}

export function createGoogleDriveState(adminEmail: string) {
  const payload = base64url({ adminEmail, nonce: crypto.randomBytes(16).toString("base64url"), issuedAt: Date.now() })
  return `${payload}.${hmac(payload)}`
}

export function verifyGoogleDriveState(token: string, adminEmail: string) {
  const [payload, signature] = String(token || "").split(".")
  if (!payload || !signature || hmac(payload) !== signature) return false
  const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))
  if (text(parsed.adminEmail).toLowerCase() !== text(adminEmail).toLowerCase()) return false
  return Date.now() - Number(parsed.issuedAt || 0) <= 10 * 60_000
}

export async function getGoogleDriveConfig() {
  const [drive, oauth] = await Promise.all([
    getServiceIntegrationConfig("googleDriveBackups").catch(() => ({} as Record<string, unknown>)),
    getServiceIntegrationConfig("googleOAuth").catch(() => ({} as Record<string, unknown>)),
  ])
  return {
    enabled: drive.enabled === true || text(drive.enabled) === "true",
    clientId: text(drive.clientId || oauth.clientId || process.env.GOOGLE_CLIENT_ID),
    clientSecret: text(drive.clientSecret || oauth.clientSecret || process.env.GOOGLE_CLIENT_SECRET),
    refreshToken: text(drive.refreshToken),
    folderId: text(drive.folderId),
    folderName: text(drive.folderName) || "ZWS Backups",
  }
}

export async function googleDriveConnectUrl(input: { adminEmail: string; redirectUri: string }) {
  const config = await getGoogleDriveConfig()
  if (!config.clientId || !config.clientSecret) throw new Error("Google Drive OAuth client is not configured.")
  const url = new URL(GOOGLE_AUTH_URL)
  url.searchParams.set("client_id", config.clientId)
  url.searchParams.set("redirect_uri", input.redirectUri)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("scope", DRIVE_SCOPE)
  url.searchParams.set("access_type", "offline")
  url.searchParams.set("prompt", "consent")
  url.searchParams.set("state", createGoogleDriveState(input.adminEmail))
  return url.toString()
}

export function getGoogleDriveCallbackUrl(request?: Request | { headers?: Headers | null } | null) {
  return googleDriveCallbackUrl(request || null)
}

export async function exchangeGoogleDriveCode(input: { code: string; redirectUri: string }) {
  const config = await getGoogleDriveConfig()
  if (!config.clientId || !config.clientSecret) throw new Error("Google Drive OAuth client is not configured.")
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: input.code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: input.redirectUri,
      grant_type: "authorization_code",
    }),
    cache: "no-store",
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok || !body.refresh_token) throw new Error(body.error_description || body.error || `Google Drive token exchange failed: ${response.status}`)
  const all = await getRuntimeIntegrationConfig({ decrypted: true, masked: false })
  await updateRuntimeIntegrationConfig({
    ...all,
    googleDriveBackups: {
      ...(all.googleDriveBackups || {}),
      enabled: true,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      refreshToken: String(body.refresh_token),
      folderName: config.folderName,
    },
    backups: {
      ...(all.backups || {}),
      provider: "google_drive",
    },
  })
  return { connected: true, scope: body.scope || DRIVE_SCOPE }
}

async function accessTokenFromRefreshToken() {
  const config = await getGoogleDriveConfig()
  if (!config.clientId || !config.clientSecret || !config.refreshToken) throw new Error("Google Drive backup is not connected.")
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: config.refreshToken,
      grant_type: "refresh_token",
    }),
    cache: "no-store",
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok || !body.access_token) throw new Error(body.error_description || body.error || `Google Drive refresh failed: ${response.status}`)
  return { accessToken: String(body.access_token), config }
}

async function driveFetch(path: string, token: string, init: RequestInit = {}) {
  const response = await fetch(`${DRIVE_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
    cache: "no-store",
  })
  return response
}

async function driveJson(path: string, token: string, init: RequestInit = {}) {
  const response = await driveFetch(path, token, init)
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body?.error?.message || `Google Drive API failed: ${response.status}`)
  return body
}

async function findFolder(token: string, name: string, parentId?: string | null) {
  const query = [
    "mimeType='application/vnd.google-apps.folder'",
    "trashed=false",
    `name='${name.replace(/'/g, "\\'")}'`,
    parentId ? `'${parentId}' in parents` : "",
  ].filter(Boolean).join(" and ")
  const result = await driveJson(`/files?q=${encodeURIComponent(query)}&fields=files(id,name)&pageSize=1`, token)
  return String(result?.files?.[0]?.id || "")
}

async function createFolder(token: string, name: string, parentId?: string | null) {
  const metadata = await driveJson("/files?fields=id", token, {
    method: "POST",
    body: JSON.stringify({
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: parentId ? [parentId] : undefined,
    }),
  })
  return String(metadata.id || "")
}

async function ensureChildFolder(token: string, name: string, parentId?: string | null) {
  return await findFolder(token, name, parentId) || await createFolder(token, name, parentId)
}

async function ensureFolder(token: string, folderId: string, folderName: string) {
  if (folderId) return folderId
  const id = await ensureChildFolder(token, folderName)
  const all = await getRuntimeIntegrationConfig({ decrypted: true, masked: false })
  await updateRuntimeIntegrationConfig({
    ...all,
    googleDriveBackups: {
      ...(all.googleDriveBackups || {}),
      folderId: id,
      folderName,
      enabled: true,
    },
    backups: {
      ...(all.backups || {}),
      provider: "google_drive",
    },
  })
  return id
}

async function ensureDatedBackupFolder(token: string, rootFolderId: string) {
  const now = new Date()
  const yyyy = String(now.getUTCFullYear())
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0")
  const dd = String(now.getUTCDate()).padStart(2, "0")
  const yearId = await ensureChildFolder(token, yyyy, rootFolderId)
  const monthId = await ensureChildFolder(token, mm, yearId)
  const dayId = await ensureChildFolder(token, dd, monthId)
  return { folderId: dayId, path: `/ZWS Backups/${yyyy}/${mm}/${dd}/` }
}

export async function uploadBackupToGoogleDrive(input: {
  filePath: string
  fileName: string
  contentType?: string
  sizeBytes: number
  checksumSha256: string
  backupType?: string | null
}) {
  const { accessToken, config } = await accessTokenFromRefreshToken()
  const rootFolderId = await ensureFolder(accessToken, config.folderId, config.folderName)
  const datedFolder = await ensureDatedBackupFolder(accessToken, rootFolderId)
  const metadata = {
    name: input.fileName,
    parents: datedFolder.folderId ? [datedFolder.folderId] : undefined,
    description: `ZWS backup sha256=${input.checksumSha256}`,
    appProperties: {
      zwsBackup: "true",
      sha256: input.checksumSha256,
      backupType: input.backupType || "backup",
      createdAt: new Date().toISOString(),
    },
  }
  const boundary = `zws_${crypto.randomBytes(12).toString("hex")}`
  const fileBytes = await import("node:fs/promises").then((fs) => fs.readFile(input.filePath))
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Type: ${input.contentType || "application/octet-stream"}\r\n\r\n`),
    fileBytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ])
  const response = await fetch(`${DRIVE_UPLOAD}/files?uploadType=multipart&fields=id,name,size,md5Checksum,webViewLink,appProperties`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
      "Content-Length": String(body.length),
    },
    body,
    cache: "no-store",
  })
  const uploaded = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(uploaded?.error?.message || `Google Drive upload failed: ${response.status}`)
  if (Number(uploaded.size || 0) !== Number(input.sizeBytes || 0)) throw new Error("Google Drive upload verification failed: size mismatch.")
  return {
    remotePath: `gdrive:${datedFolder.path}${uploaded.name || input.fileName}`,
    remoteChecksum: uploaded.md5Checksum || null,
    webViewLink: uploaded.webViewLink || null,
    fileId: uploaded.id,
  }
}

async function latestBackupSignals() {
  const [lastRun, lastRestore] = await Promise.all([
    (prisma as any).backupRun.findFirst({ orderBy: { createdAt: "desc" } }).catch(() => null),
    (prisma as any).backupRestoreTest.findFirst({ orderBy: { createdAt: "desc" } }).catch(() => null),
  ])
  return {
    lastSync: lastRun ? {
      status: lastRun.status || null,
      at: lastRun.completedAt?.toISOString?.() || lastRun.createdAt?.toISOString?.() || null,
      remotePath: lastRun.remotePath || null,
      checksumSha256: lastRun.checksumSha256 || null,
    } : null,
    restoreHealth: lastRestore ? {
      status: lastRestore.status || null,
      at: lastRestore.testedAt?.toISOString?.() || lastRestore.createdAt?.toISOString?.() || null,
      error: lastRestore.error || null,
    } : null,
  }
}

async function updateDriveHealthPatch(patch: Record<string, unknown>) {
  const all = await getRuntimeIntegrationConfig({ decrypted: true, masked: false }).catch(() => ({} as Record<string, Record<string, unknown>>))
  await updateRuntimeIntegrationConfig({
    ...all,
    googleDriveBackups: {
      ...(all.googleDriveBackups || {}),
      ...patch,
    },
  }, "google-drive-health").catch(() => null)
}

export async function testGoogleDriveBackupUpload() {
  const payload = Buffer.from(`zws-google-drive-health:${new Date().toISOString()}\n`)
  const checksumSha256 = crypto.createHash("sha256").update(payload).digest("hex")
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "zws-gdrive-health-"))
  const filePath = path.join(tempDir, `zws-google-drive-health-${Date.now()}.txt`)
  await fs.writeFile(filePath, payload)
  try {
    const uploaded = await uploadBackupToGoogleDrive({
      filePath,
      fileName: path.basename(filePath),
      contentType: "text/plain",
      sizeBytes: payload.length,
      checksumSha256,
    })
    const { accessToken } = await accessTokenFromRefreshToken()
    const metadata = await driveJson(`/files/${encodeURIComponent(uploaded.fileId)}?fields=id,name,size,appProperties,trashed`, accessToken)
    const verified = String(metadata?.appProperties?.sha256 || "") === checksumSha256
      && Number(metadata?.size || 0) === payload.length
      && metadata?.trashed !== true
    if (!verified) throw new Error("Google Drive upload health check failed checksum or size verification.")
    await driveFetch(`/files/${encodeURIComponent(uploaded.fileId)}`, accessToken, { method: "DELETE" }).catch(() => null)
    const result = { status: "healthy", at: new Date().toISOString(), checksumSha256, fileId: uploaded.fileId }
    await updateDriveHealthPatch({ uploadHealth: result })
    return result
  } catch (error: any) {
    const result = { status: "failed", at: new Date().toISOString(), error: error?.message || String(error) }
    await updateDriveHealthPatch({ uploadHealth: result })
    throw error
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

export async function googleDriveBackupHealth() {
  const config = await getGoogleDriveConfig()
  const all = await getRuntimeIntegrationConfig({ decrypted: true, masked: false }).catch(() => ({} as Record<string, Record<string, unknown>>))
  const savedDrive = all.googleDriveBackups || {}
  const signals = await latestBackupSignals()
  const base = {
    enabled: config.enabled,
    connected: Boolean(config.refreshToken),
    folderId: config.folderId || null,
    folderName: config.folderName,
    tokenValidity: { valid: false, error: config.refreshToken ? null : "not_connected" },
    quota: null as null | Record<string, unknown>,
    folderStatus: null as null | Record<string, unknown>,
    uploadHealth: savedDrive.uploadHealth || null,
    lastSync: signals.lastSync,
    restoreHealth: signals.restoreHealth,
  }
  if (!config.clientId || !config.clientSecret || !config.refreshToken) {
    return {
      ok: false,
      ...base,
    }
  }
  try {
    const { accessToken } = await accessTokenFromRefreshToken()
    const [about, folder] = await Promise.all([
      driveJson("/about?fields=storageQuota,user", accessToken).catch((error: any) => ({ error: error?.message || String(error) })),
      config.folderId
        ? driveJson(`/files/${encodeURIComponent(config.folderId)}?fields=id,name,mimeType,trashed`, accessToken).catch((error: any) => ({ error: error?.message || String(error) }))
        : Promise.resolve({ status: "not_created", folderName: config.folderName }),
    ])
    const folderHealthy = !("error" in folder) && (folder as any).trashed !== true
    return {
      ok: Boolean(config.enabled && folderHealthy && !("error" in about)),
      ...base,
      tokenValidity: { valid: true, checkedAt: new Date().toISOString() },
      quota: "error" in about ? { error: about.error } : (about as Record<string, unknown>).storageQuota || null,
      folderStatus: folder,
    }
  } catch (error: any) {
    return {
      ok: false,
      ...base,
      tokenValidity: { valid: false, error: error?.message || String(error), checkedAt: new Date().toISOString() },
    }
  }
}
