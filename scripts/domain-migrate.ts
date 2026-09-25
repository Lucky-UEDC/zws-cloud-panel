#!/usr/bin/env node
import "dotenv/config"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { PrismaClient } from "@prisma/client"
import { getNormalizedAppUrl, getNormalizedSiteDomain } from "../lib/runtime-domain"

const prisma = new PrismaClient()
const args = new Set(process.argv.slice(2))
const dryRun = args.has("--dry-run")
const clearCache = args.has("--clear-cache")
const runChecks = args.has("--checks")
const reloadPm2 = args.has("--reload-pm2")

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

function cleanOrigin(value: string) {
  return value.trim().replace(/\/+$/, "")
}

function shell(command: string, commandArgs: string[]) {
  console.log(`$ ${[command, ...commandArgs].join(" ")}`)
  if (dryRun) return
  const result = spawnSync(command, commandArgs, { stdio: "inherit", cwd: process.cwd(), env: process.env })
  if (result.status !== 0) process.exit(result.status || 1)
}

function textArray(value: string | undefined) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
}

function gatewayWebhookUrl(gateway: string, appUrl: string) {
  const code = gateway.toLowerCase()
  return `${appUrl}/api/payments/webhook?gateway=${encodeURIComponent(code)}`
}

function gatewayReturnUrl(appUrl: string) {
  return `${appUrl}/payment/status?order_id={order_id}`
}

function sqlQuote(value: string) {
  return `'${value.replace(/'/g, "''")}'`
}

async function discoverReplacementSources(siteDomain: string, appUrl: string) {
  const configured = textArray(process.env.DOMAIN_MIGRATE_FROM)
  const domainRows = await prisma.domainConfig.findMany({ select: { domain: true, appBaseUrl: true } }).catch(() => [])
  const discovered = domainRows.flatMap((row) => [row.domain, row.appBaseUrl])
  const candidates = Array.from(new Set([...configured, ...discovered]))
    .map((value) => cleanOrigin(value))
    .filter((value) => value && value !== siteDomain && value !== appUrl)
  return candidates
}

async function upsertPrimaryDomain(siteDomain: string, appUrl: string) {
  const existing = await prisma.domainConfig.findFirst({
    where: { OR: [{ domain: siteDomain }, { isPrimary: true }] },
    orderBy: [{ isPrimary: "desc" }, { updatedAt: "desc" }],
  })

  if (dryRun) {
    console.log(`[dry-run] primary domain => ${siteDomain} (${appUrl})`)
    return existing?.id || null
  }

  const domain = existing
    ? await prisma.domainConfig.update({
        where: { id: existing.id },
        data: {
          domain: siteDomain,
          appBaseUrl: appUrl,
          isPrimary: true,
          isActive: true,
          canonicalRedirectEnabled: false,
          allowedGatewayModes: ["cashfree", "phonepe", "manual", "wallet"],
          defaultGateway: existing.defaultGateway || "phonepe",
        },
      })
    : await prisma.domainConfig.create({
        data: {
          domain: siteDomain,
          displayName: process.env.NEXT_PUBLIC_APP_NAME || process.env.APP_NAME || "Cloud",
          brandName: process.env.NEXT_PUBLIC_APP_NAME || process.env.APP_NAME || "Cloud",
          appBaseUrl: appUrl,
          isPrimary: true,
          isActive: true,
          canonicalRedirectEnabled: false,
          allowedGatewayModes: ["cashfree", "phonepe", "manual", "wallet"],
          defaultGateway: "phonepe",
          fallbackGateway: null,
          environmentMode: "production",
          metadata: {},
        },
      })

  await prisma.domainConfig.updateMany({
    where: { id: { not: domain.id } },
    data: { isPrimary: false },
  })

  return domain.id
}

async function regenerateGatewayUrls(domainId: string | null, siteDomain: string, appUrl: string) {
  const gatewayRows = await prisma.domainGatewayConfig.findMany({
    where: domainId ? { domainId } : {},
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
  }).catch(() => [])
  const gateways = new Set(["cashfree", "phonepe", ...gatewayRows.map((row) => row.gateway)])

  for (const gateway of gateways) {
    const existing = gatewayRows.find((row) => row.gateway === gateway)
    const data = {
      approvedPaymentDomain: siteDomain,
      webhookUrl: gatewayWebhookUrl(gateway, appUrl),
      returnUrl: gatewayReturnUrl(appUrl),
      startUrl: null,
    }
    if (dryRun) {
      console.log(`[dry-run] ${gateway} gateway URLs => ${data.webhookUrl}`)
      continue
    }
    if (existing) {
      await prisma.domainGatewayConfig.update({ where: { id: existing.id }, data })
    } else if (domainId) {
      await prisma.domainGatewayConfig.create({
        data: {
          domainId,
          gateway,
          enabled: false,
          priority: gateway === "phonepe" ? 10 : gateway === "cashfree" ? 20 : 100,
          environment: "production",
          displayName: gateway.charAt(0).toUpperCase() + gateway.slice(1),
          extraConfig: {},
          ...data,
        },
      })
    }
  }

  if (!dryRun) {
    await prisma.paymentGateway.updateMany({
      where: { OR: [{ code: { in: ["cashfree", "phonepe"] } }, { provider: { in: ["cashfree", "phonepe"] } }] },
      data: { callbackUrl: gatewayReturnUrl(appUrl) },
    }).catch(() => null)
    for (const gateway of ["cashfree", "phonepe"]) {
      await prisma.paymentGateway.updateMany({
        where: { OR: [{ code: gateway }, { provider: gateway }] },
        data: { webhookUrl: gatewayWebhookUrl(gateway, appUrl) },
      }).catch(() => null)
    }
  }
}

async function rewriteStaleValues(sources: string[], siteDomain: string, appUrl: string) {
  if (sources.length === 0) {
    console.log("No stale domains discovered. Set DOMAIN_MIGRATE_FROM to force replacements.")
    return
  }

  const runtimeTables = new Set([
    "admin_settings",
    "app_settings",
    "domain_configs",
    "domain_gateway_configs",
    "email_configs",
    "payment_gateways",
    "settings",
    "system_settings",
    "whatsapp_template_variables",
  ])

  const columns = (await prisma.$queryRawUnsafe<Array<{ table_name: string; column_name: string; data_type: string }>>(`
    SELECT table_name, column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND data_type IN ('text', 'character varying', 'json', 'jsonb')
  `)).filter((column) => runtimeTables.has(column.table_name))

  for (const source of sources) {
    const sourceOrigin = /^https?:\/\//i.test(source) ? source : `https://${source}`
    const sourceDomain = source.replace(/^https?:\/\//i, "").replace(/\/.*$/, "")
    for (const column of columns) {
      const table = `"${column.table_name.replace(/"/g, '""')}"`
      const field = `"${column.column_name.replace(/"/g, '""')}"`
      const replacement = `
        replace(
          replace(${field}::text, ${sqlQuote(sourceOrigin)}, ${sqlQuote(appUrl)}),
          ${sqlQuote(sourceDomain)},
          ${sqlQuote(siteDomain)}
        )
      `
      const sql = column.data_type === "json" || column.data_type === "jsonb"
        ? `UPDATE ${table} SET ${field} = (${replacement})::${column.data_type} WHERE ${field}::text LIKE ${sqlQuote(`%${sourceDomain}%`)}`
        : `UPDATE ${table} SET ${field} = ${replacement} WHERE ${field} LIKE ${sqlQuote(`%${sourceDomain}%`)}`
      if (dryRun) {
        const countSql = `SELECT COUNT(*)::int AS count FROM ${table} WHERE ${field}::text LIKE ${sqlQuote(`%${sourceDomain}%`)}`
        const count = await prisma.$queryRawUnsafe<Array<{ count: number }>>(countSql).catch(() => [{ count: 0 }])
        if (Number(count[0]?.count || 0) > 0) console.log(`[dry-run] ${column.table_name}.${column.column_name}: ${count[0].count} row(s)`)
      } else {
        await prisma.$executeRawUnsafe(sql).catch((error) => {
          console.warn(`Skipped ${column.table_name}.${column.column_name}: ${error?.message || error}`)
        })
      }
    }
  }
}

async function main() {
  const siteDomain = getNormalizedSiteDomain()
  const appUrl = getNormalizedAppUrl()
  if (!siteDomain) fail("SITE_DOMAIN is required.")
  if (!appUrl) fail("APP_URL or NEXT_PUBLIC_APP_URL is required.")
  if (cleanOrigin(process.env.NEXT_PUBLIC_APP_URL || "") !== appUrl) fail("NEXT_PUBLIC_APP_URL must match APP_URL.")
  if (cleanOrigin(process.env.NEXTAUTH_URL || "") !== appUrl) fail("NEXTAUTH_URL must match APP_URL.")

  const replacementSources = await discoverReplacementSources(siteDomain, appUrl)
  const domainId = await upsertPrimaryDomain(siteDomain, appUrl)
  await regenerateGatewayUrls(domainId, siteDomain, appUrl)
  await rewriteStaleValues(replacementSources, siteDomain, appUrl)

  if (clearCache) {
    const nextDir = path.join(process.cwd(), ".next")
    console.log(`${dryRun ? "[dry-run] " : ""}remove ${nextDir}`)
    if (!dryRun) fs.rmSync(nextDir, { recursive: true, force: true })
  }
  if (runChecks) {
    shell("pnpm", ["typecheck"])
    shell("pnpm", ["lint"])
    shell("pnpm", ["build"])
  }
  if (reloadPm2) {
    shell("pm2", ["reload", "ecosystem.config.js", "--update-env"])
  }
}

main()
  .catch((error) => {
    console.error(error?.message || error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
