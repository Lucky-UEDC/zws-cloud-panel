import { prisma } from "@/lib/db"
import { decryptSecretValue, encryptSecretValue } from "@/lib/secret-crypto"

export type DatabasePurpose = "MAIN" | "TEST" | "STAGING" | "CUSTOMER"

export type DatabaseRegistryInput = {
  key: string
  purpose: DatabasePurpose
  displayName: string
  hostname: string
  port?: number
  databaseName: string
  username: string
  url?: string | null
  sslMode?: string
  isActive?: boolean
  metadata?: Record<string, unknown>
}

function cleanKey(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-")
}

export function encryptDatabaseUrl(url: string | null | undefined) {
  const value = String(url || "").trim()
  return value ? encryptSecretValue(value) : null
}

export function decryptDatabaseUrl(value: string | null | undefined) {
  const raw = String(value || "").trim()
  return raw ? decryptSecretValue(raw) : ""
}

export async function upsertDatabaseRegistry(input: DatabaseRegistryInput) {
  const key = cleanKey(input.key)
  const data = {
    purpose: input.purpose,
    displayName: input.displayName,
    hostname: input.hostname,
    port: input.port || 5432,
    databaseName: input.databaseName,
    username: input.username,
    encryptedUrl: encryptDatabaseUrl(input.url),
    sslMode: input.sslMode || "require",
    isActive: input.isActive ?? true,
    metadata: input.metadata || {},
  }
  return (prisma as any).databaseRegistry.upsert({
    where: { key },
    update: data,
    create: { key, ...data },
  })
}

export async function seedDefaultDatabaseRegistry() {
  const password = process.env.DATABASE_PASSWORD || process.env.POSTGRES_PASSWORD || ""
  const hostname = process.env.DATABASE_HOST || "db-tunnel"
  const port = Number(process.env.DATABASE_PORT || process.env.DATABASE_TUNNEL_PORT || 15432)
  const username = process.env.DATABASE_USER || process.env.POSTGRES_USER || "zwscloud_app"
  const sslMode = process.env.DATABASE_SSLMODE || "require"
  const names = [
    ["main", "MAIN", process.env.DATABASE_NAME || process.env.POSTGRES_DB || "zwscloud"],
    ["staging", "STAGING", process.env.STAGING_DATABASE_NAME || "zwscloud_staging"],
    ["test", "TEST", process.env.TEST_DATABASE_NAME || "zwscloud_test"],
  ] as const

  const rows = []
  for (const [key, purpose, databaseName] of names) {
    const url = password
      ? `postgresql://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${hostname}:${port}/${databaseName}?schema=public&sslmode=${sslMode}`
      : null
    rows.push(await upsertDatabaseRegistry({
      key,
      purpose,
      displayName: `${databaseName} database`,
      hostname,
      port,
      databaseName,
      username,
      url,
      sslMode,
      metadata: { source: "docker-defaults" },
    }))
  }
  return rows
}

export async function mapTenantToDatabase(input: {
  tenantKey: string
  tenantType?: string
  databaseKey: string
  metadata?: Record<string, unknown>
}) {
  const database = await (prisma as any).databaseRegistry.findUnique({ where: { key: cleanKey(input.databaseKey) } })
  if (!database) throw new Error(`Database registry entry not found: ${input.databaseKey}`)
  return (prisma as any).tenantDatabaseMapping.upsert({
    where: {
      tenantKey_tenantType_isPrimary: {
        tenantKey: input.tenantKey,
        tenantType: input.tenantType || "customer",
        isPrimary: true,
      },
    },
    update: { databaseRegistryId: database.id, metadata: input.metadata || {} },
    create: {
      tenantKey: input.tenantKey,
      tenantType: input.tenantType || "customer",
      databaseRegistryId: database.id,
      isPrimary: true,
      metadata: input.metadata || {},
    },
  })
}
