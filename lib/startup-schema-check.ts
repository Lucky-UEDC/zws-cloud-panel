import { classifyEnterpriseError } from "@/lib/enterprise-error-classifier"
import { getSchemaHealthReport, REQUIRED_ENTERPRISE_TABLES, type MissingColumn } from "@/lib/schema-health"

const CHECK_TTL_MS = 20_000

export type StartupSchemaCheckResult = {
  ok: boolean
  checkedAt: string
  missingTables: string[]
  missingColumns: MissingColumn[]
  pendingMigrations: string[]
  failedMigrations: string[]
  pendingDeploy: boolean
  degradedMode: boolean
  degradedFeatures: string[]
  failedStartupChecks: string[]
  safeMode: {
    advancedVmNetworkingEnabled: boolean
    ipAssignmentLayerEnabled: boolean
    networkTimelineEnabled: boolean
    ordersEnabled: boolean
    vmListEnabled: boolean
    provisioningEnabled: boolean
    billingEnabled: boolean
  }
}

let cache: { expiresAt: number; result: StartupSchemaCheckResult } | null = null

function buildResult(input: {
  missingTables: string[]
  missingColumns: MissingColumn[]
  pendingMigrations: string[]
  failedMigrations: string[]
  failedStartupChecks: string[]
}): StartupSchemaCheckResult {
  const degradedFeatures = [
    "advanced_vm_networking",
    "ip_assignment_layer",
    "network_timeline_queries",
  ]
  const degradedMode = input.missingTables.length > 0 || input.missingColumns.length > 0 || input.pendingMigrations.length > 0 || input.failedMigrations.length > 0 || input.failedStartupChecks.length > 0
  const ok = !degradedMode
  return {
    ok,
    checkedAt: new Date().toISOString(),
    missingTables: input.missingTables,
    missingColumns: input.missingColumns,
    pendingMigrations: input.pendingMigrations,
    failedMigrations: input.failedMigrations,
    pendingDeploy: input.pendingMigrations.length > 0,
    degradedMode,
    degradedFeatures: degradedMode ? degradedFeatures : [],
    failedStartupChecks: input.failedStartupChecks,
    safeMode: {
      advancedVmNetworkingEnabled: !degradedMode,
      ipAssignmentLayerEnabled: !degradedMode,
      networkTimelineEnabled: !degradedMode,
      ordersEnabled: true,
      vmListEnabled: true,
      provisioningEnabled: true,
      billingEnabled: true,
    },
  }
}

export async function getStartupSchemaCheck(forceRefresh = false): Promise<StartupSchemaCheckResult> {
  if (!forceRefresh && cache && cache.expiresAt > Date.now()) return cache.result

  const failedStartupChecks: string[] = []
  let missingTables: string[] = [...REQUIRED_ENTERPRISE_TABLES]
  let missingColumns: MissingColumn[] = []
  let failedMigrations: string[] = []
  let pendingMigrations: string[] = []

  try {
    const report = await getSchemaHealthReport({ fullPrismaShape: false })
    missingTables = report.missingTables
    missingColumns = report.missingColumns
    failedMigrations = report.failedMigrations
    pendingMigrations = report.pendingMigrations
  } catch (error) {
    const classified = classifyEnterpriseError(error)
    failedStartupChecks.push(classified.kind)
    failedStartupChecks.push("startup_schema_check_failed")
  }

  const result = buildResult({
    missingTables,
    missingColumns,
    pendingMigrations,
    failedMigrations,
    failedStartupChecks: Array.from(new Set(failedStartupChecks)),
  })

  cache = {
    expiresAt: Date.now() + CHECK_TTL_MS,
    result,
  }

  return result
}

export async function getEnterpriseNetworkingGate(forceRefresh = false) {
  const envEnabled = String(process.env.ENTERPRISE_IPAM_ENABLED ?? "true").trim().toLowerCase() !== "false"
  if (!envEnabled) {
    return {
      enabled: false,
      reason: "Enterprise VM networking is disabled by ENTERPRISE_IPAM_ENABLED.",
      startup: await getStartupSchemaCheck(forceRefresh),
    }
  }
  const check = await getStartupSchemaCheck(forceRefresh)
  return {
    enabled: check.safeMode.advancedVmNetworkingEnabled,
    reason: check.degradedMode
      ? "Enterprise VM networking is temporarily disabled because schema or migration checks failed."
      : null,
    startup: check,
  }
}

export function isEnterpriseIpamEnabledByEnv() {
  return String(process.env.ENTERPRISE_IPAM_ENABLED ?? "true").trim().toLowerCase() !== "false"
}
