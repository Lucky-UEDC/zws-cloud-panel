import type { PrismaClient } from "@prisma/client"
import { createRequire } from "node:module"
import { prisma } from "@/lib/db"
import { decryptDatabaseUrl } from "@/lib/database-registry"

const runtimeRequire = createRequire(import.meta.url)
const MAX_CLIENTS = Number(process.env.DB_MANAGER_MAX_CLIENTS || 12)
const clients = new Map<string, { client: PrismaClient; lastUsed: number }>()

function PrismaClientConstructor(): new (...args: any[]) => PrismaClient {
  const mod = runtimeRequire("@prisma/client") as {
    PrismaClient?: new (...args: any[]) => PrismaClient
    default?: { PrismaClient?: new (...args: any[]) => PrismaClient }
  }
  const Constructor = mod.PrismaClient || mod.default?.PrismaClient
  if (!Constructor) throw new Error("@prisma/client PrismaClient is unavailable")
  return Constructor
}

function buildUrl(row: any) {
  const encrypted = decryptDatabaseUrl(row?.encryptedUrl || row?.encrypted_url)
  if (encrypted) return encrypted
  const url = new URL(`postgresql://${row.hostname}:${row.port || 5432}/${row.databaseName || row.database_name}`)
  url.username = row.username
  url.searchParams.set("schema", "public")
  url.searchParams.set("sslmode", row.sslMode || row.ssl_mode || "require")
  return url.toString()
}

async function pruneClients() {
  if (clients.size < MAX_CLIENTS) return
  const stale = [...clients.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed)
  const [key, entry] = stale[0] || []
  if (!key || !entry) return
  clients.delete(key)
  await entry.client.$disconnect().catch(() => undefined)
}

export async function getDatabaseClientByKey(key: string): Promise<PrismaClient> {
  const normalized = key.trim().toLowerCase()
  const cached = clients.get(normalized)
  if (cached) {
    cached.lastUsed = Date.now()
    return cached.client
  }
  const row = await (prisma as any).databaseRegistry.findUnique({ where: { key: normalized } })
  if (!row?.isActive) throw new Error(`Database registry entry is inactive or missing: ${key}`)
  await pruneClients()
  const client = new (PrismaClientConstructor())({
    datasources: { db: { url: buildUrl(row) } },
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : [{ emit: "stdout", level: "error" }],
  } as any)
  clients.set(normalized, { client, lastUsed: Date.now() })
  return client
}

export async function getDatabaseClientForTenant(tenantKey: string, tenantType = "customer") {
  const mapping = await (prisma as any).tenantDatabaseMapping.findFirst({
    where: { tenantKey, tenantType, isPrimary: true, database: { isActive: true } },
    include: { database: true },
  })
  if (!mapping?.database?.key) throw new Error(`No active database mapping for ${tenantType}:${tenantKey}`)
  return getDatabaseClientByKey(mapping.database.key)
}

export async function withDatabase<T>(key: string, fn: (client: PrismaClient) => Promise<T>) {
  const client = await getDatabaseClientByKey(key)
  return fn(client)
}

export async function withTenantDatabase<T>(tenantKey: string, fn: (client: PrismaClient) => Promise<T>, tenantType = "customer") {
  const client = await getDatabaseClientForTenant(tenantKey, tenantType)
  return fn(client)
}

export async function disconnectManagedDatabaseClients() {
  const current = [...clients.values()]
  clients.clear()
  await Promise.all(current.map((entry) => entry.client.$disconnect().catch(() => undefined)))
}
