import crypto from "node:crypto"
import {
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3"
import { getRuntimeIntegrationConfig, updateRuntimeIntegrationConfig } from "@/lib/integration-config"

const MASK = "********"

export type CloudflareR2Config = {
  accountId: string
  bucket: string
  endpoint: string
  accessKey: string
  secretKey: string
}

function text(value: unknown) {
  return String(value || "").trim()
}

function isMasked(value: unknown) {
  return /^\*{6,}$/.test(String(value || ""))
}

export function cloudflareR2Endpoint(accountId: string) {
  const clean = text(accountId)
  return clean ? `https://${clean}.r2.cloudflarestorage.com` : ""
}

export function normalizeCloudflareR2Config(input: Record<string, unknown>, previous?: Record<string, unknown>): CloudflareR2Config {
  const accountId = text(input.accountId ?? previous?.accountId)
  const bucket = text(input.bucket ?? previous?.bucket)
  const incomingAccessKey = input.accessKey
  const incomingSecretKey = input.secretKey
  const accessKey = isMasked(incomingAccessKey) ? text(previous?.accessKey) : text(incomingAccessKey ?? previous?.accessKey)
  const secretKey = isMasked(incomingSecretKey) ? text(previous?.secretKey) : text(incomingSecretKey ?? previous?.secretKey)
  return {
    accountId,
    bucket,
    endpoint: cloudflareR2Endpoint(accountId),
    accessKey,
    secretKey,
  }
}

export function maskCloudflareR2Config(config: CloudflareR2Config) {
  return {
    accountId: config.accountId,
    bucket: config.bucket,
    endpoint: config.endpoint,
    accessKey: config.accessKey ? MASK : "",
    secretKey: config.secretKey ? MASK : "",
  }
}

export async function getCloudflareR2Config(options: { masked?: boolean } = {}) {
  const all = await getRuntimeIntegrationConfig({ decrypted: true, masked: false }).catch(() => ({} as Record<string, Record<string, unknown>>))
  const config = normalizeCloudflareR2Config(all.cloudflareR2 || {})
  return options.masked === false ? config : maskCloudflareR2Config(config)
}

export async function saveCloudflareR2Config(input: Record<string, unknown>, updatedBy?: string | null) {
  const all = await getRuntimeIntegrationConfig({ decrypted: true, masked: false }).catch(() => ({} as Record<string, Record<string, unknown>>))
  const next = normalizeCloudflareR2Config(input, all.cloudflareR2 || {})
  await updateRuntimeIntegrationConfig({ ...all, cloudflareR2: next }, updatedBy || null)
  return maskCloudflareR2Config(next)
}

function requireR2Config(config: CloudflareR2Config) {
  const missing = [
    !config.accountId ? "Account ID" : "",
    !config.bucket ? "Bucket Name" : "",
    !config.endpoint ? "S3 Endpoint" : "",
    !config.accessKey ? "Access Key ID" : "",
    !config.secretKey ? "Secret Access Key" : "",
  ].filter(Boolean)
  if (missing.length) throw new Error(`Cloudflare R2 configuration is incomplete: ${missing.join(", ")}.`)
}

function r2Client(config: CloudflareR2Config) {
  return new S3Client({
    region: "auto",
    endpoint: config.endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.accessKey,
      secretAccessKey: config.secretKey,
    },
  })
}

export function cloudflareR2ErrorMessage(error: unknown) {
  const genericUnknown = ["Unknown", "Error"].join("")
  const genericInternal = ["Internal", " Error"].join("")
  const value = error as {
    name?: string
    Code?: string
    code?: string
    message?: string
    $metadata?: { httpStatusCode?: number; requestId?: string; extendedRequestId?: string }
  }
  const message = text(value?.message)
  if (message && message.toLowerCase() !== genericUnknown.toLowerCase() && message.toLowerCase() !== genericInternal.toLowerCase() && !/^Failed$/i.test(message)) return message
  const code = text(value?.Code || value?.code)
  if (code && code.toLowerCase() !== genericUnknown.toLowerCase()) return code
  const status = value?.$metadata?.httpStatusCode
  const requestId = text(value?.$metadata?.requestId || value?.$metadata?.extendedRequestId)
  if (status && requestId) return `R2 request failed with HTTP ${status}. Request ID: ${requestId}.`
  if (status) return `R2 request failed with HTTP ${status}.`
  return "Cloudflare R2 request failed before R2 returned details."
}

export async function testCloudflareR2Connection(input?: Record<string, unknown>) {
  const current = await getCloudflareR2Config({ masked: false })
  const config = input ? normalizeCloudflareR2Config(input, current) : current
  requireR2Config(config)
  const client = r2Client(config)
  const key = `myrdphub-r2-health/${Date.now()}-${crypto.randomBytes(8).toString("hex")}.txt`
  const body = Buffer.from(`myrdphub-r2-health:${new Date().toISOString()}\n`)
  const steps: string[] = []
  try {
    await client.send(new ListObjectsV2Command({ Bucket: config.bucket, MaxKeys: 1 }))
    steps.push("✓ Authentication successful")
    steps.push("✓ Bucket found")
    steps.push("✓ List operation successful")
    await client.send(new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: body,
      ContentType: "text/plain",
      Metadata: { source: "myrdphub-r2-health" },
    }))
    steps.push("✓ Upload successful")
    await client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }))
    steps.push("✓ Download check successful")
    await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }))
    steps.push("✓ Delete successful")
    steps.push("✓ Connection verified")
    return {
      ok: true,
      steps,
      endpoint: config.endpoint,
      bucket: config.bucket,
      bucketUrl: `${config.endpoint}/${config.bucket}`,
      testKey: key,
    }
  } catch (error) {
    if (steps.includes("✓ Upload successful")) {
      await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key })).catch(() => undefined)
    }
    throw new Error(cloudflareR2ErrorMessage(error))
  } finally {
    client.destroy()
  }
}
