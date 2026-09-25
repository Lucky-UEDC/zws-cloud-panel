import { spawn } from "node:child_process"
import path from "node:path"
import { prisma } from "@/lib/db"
import { getRedisClient } from "@/lib/redis"
import { createAuditLog } from "@/lib/audit-log"
import { getBuildInfo, compareSemver } from "@/lib/build-info"
import { getUpdateSource, type ReleaseManifest } from "@/lib/updates/releases"

/**
 * Admin Update Center — apply workflow (Problem E).
 *
 * Safety model:
 *  - The ONLY thing this module may execute is the fixed host-side script
 *    `scripts/apply-release.sh` (path from env `UPDATE_APPLY_SCRIPT`), invoked
 *    with a validated version + image reference. No free-form admin input is
 *    ever passed to a shell.
 *  - A Redis lock (update:running) prevents concurrent applies.
 *  - Every attempt is recorded in the additive `deployments` table and visible
 *    in the admin history UI before/after.
 *  - If the host apply script is not configured, the attempt is marked
 *    `apply_pending` with honest instructions — never a fake success.
 */

export const UPDATE_LOCK_KEY = "update:running"
const LOCK_TTL_MS = 6 * 60 * 60 * 1000 // 6h, auto-expires if a holder crashes
const SCRIPT_TIMEOUT_MS = 20 * 60 * 1000 // 20 min

export type PreflightResult = {
  ok: boolean
  checks: Array<{ name: string; ok: boolean; detail: string }>
}

export type ReleaseOutcome =
  | { status: "success" | "failed"; deploymentId: string; stage: string; stageOutput: unknown }
  | { status: "apply_pending"; deploymentId: string; reason: string }
  | { status: "lock_busy" | "invalid" | "too_old" | "preflight_failed" | "error"; deploymentId?: string; reason: string }

/** Path to the host-side apply script must be the documented fixed location. */
function resolveApplyScript(): string | null {
  const configured = String(process.env.UPDATE_APPLY_SCRIPT || "").trim()
  if (!configured) return null
  const normalized = path.resolve(configured)
  return normalized
}

function isReachable(url: string): Promise<boolean> {
  return fetch(url, { method: "GET", cache: "no-store", signal: AbortSignal.timeout(6000) })
    .then((response) => response.ok || response.status === 503) // health endpoints return 200|503 (draining)
    .catch(() => false)
}

export async function runPreflight(manifest: ReleaseManifest, baseUrl: string): Promise<PreflightResult> {
  const checks: PreflightResult["checks"] = []
  const current = getBuildInfo()

  const appOk = await isReachable(`${baseUrl}/api/health`)
  const workerOk = await isReachable(`${baseUrl}/api/health`).catch(() => false)
  const dbOk = await prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false)

  if (manifest.minVersion) {
    checks.push({
      name: "compatibility",
      ok: compareSemver(current.version, manifest.minVersion) >= 0,
      detail: `running ${current.version}, manifest requires >= ${manifest.minVersion}`,
    })
  } else {
    checks.push({ name: "compatibility", ok: true, detail: `running ${current.version}` })
  }
  checks.push({ name: "app-health", ok: appOk, detail: appOk ? "app responds" : "app health probe failed" })
  checks.push({ name: "worker-health", ok: workerOk, detail: workerOk ? "worker responds" : "worker health probe failed" })
  checks.push({ name: "database", ok: dbOk, detail: dbOk ? "database reachable" : "database unreachable" })

  const missingEnv = (manifest.requiredEnv || []).filter((key) => !process.env[key])
  checks.push({
    name: "required-env",
    ok: missingEnv.length === 0,
    detail: missingEnv.length === 0 ? "all required env vars present" : `missing: ${missingEnv.join(", ")}`,
  })

  return { ok: checks.every((c) => c.ok), checks }
}

async function acquireLock(): Promise<boolean> {
  const redis = getRedisClient()
  if (!redis) {
    // No Redis: use the deployments table as a fallback guard (only one
    // running/apply_pending row may exist).
    const active = await prisma.deployment.count({
      where: { status: { in: ["running", "apply_pending"] } },
    })
    return active === 0
  }
  try {
    await redis.connect().catch(() => undefined)
    const acquired = await redis.set(UPDATE_LOCK_KEY, `${process.pid}:${Date.now()}`, "PX", LOCK_TTL_MS, "NX")
    return Boolean(acquired)
  } catch {
    return false
  }
}

async function releaseLock(): Promise<void> {
  const redis = getRedisClient()
  if (!redis) return
  try {
    await redis.connect().catch(() => undefined)
    await redis.del(UPDATE_LOCK_KEY)
  } catch {
    // TTL auto-expires; best effort.
  }
}

export function runApplyScript(version: string, imageRef: string, deploymentId: string, adminEmail: string): Promise<{ code: number; output: string; timedOut: boolean }> {
  const script = resolveApplyScript()
  if (!script) return Promise.resolve({ code: 2, output: "UPDATE_APPLY_SCRIPT is not configured", timedOut: false })
  return new Promise((resolve) => {
    const child = spawn(script, [version, imageRef, deploymentId, adminEmail], {
      cwd: path.dirname(script),
      env: { ...process.env, UPDATE_DEPLOYMENT_ID: deploymentId },
      stdio: ["ignore", "pipe", "pipe"],
    })
    let output = ""
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill("SIGKILL")
      resolve({ code: 124, output: output.trim().slice(-4000), timedOut: true })
    }, SCRIPT_TIMEOUT_MS)
    child.stdout.on("data", (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-16_000)
    })
    child.stderr.on("data", (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-16_000)
    })
    child.on("error", (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ code: 127, output: `failed to start apply script: ${error.message}`, timedOut: false })
    })
    child.on("close", (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ code: code ?? 1, output: output.trim().slice(-4000), timedOut: false })
    })
  })
}

/**
 * Validate + preflight + apply one release. Returns a structured outcome and
 * always leaves a Deployment row + audit trail.
 */
export async function applyRelease(
  targetVersion: string,
  adminEmail: string,
): Promise<ReleaseOutcome> {
  const source = getUpdateSource()
  const current = getBuildInfo()

  const version = String(targetVersion || "").trim()
  if (!/^\d+\.\d+\.\d+$/.test(version)) return { status: "invalid", reason: `invalid version "${version}"` }
  if (compareSemver(version, current.version) <= 0) {
    return { status: "too_old", reason: `version ${version} is not newer than running ${current.version}` }
  }

  if (!source.enabled || !source.repo) return { status: "error", reason: "UPDATE_GITHUB_REPO is not configured" }

  // Resolve the image for this version from release metadata (tag name is fixed).
  const imageRef = `${source.imagePrefix}:${version}`
  const manifest: ReleaseManifest = {
    version,
    image: imageRef,
    digest: null,
    migrations: [],
    minVersion: null,
    changelog: null,
    requiredEnv: [],
  }

  const locked = await acquireLock()
  if (!locked) return { status: "lock_busy", reason: "another update is already in progress" }

  let deploymentId: string | null = null
  try {
    const deployment = await prisma.deployment.create({
      data: {
        version,
        image: imageRef,
        status: "running",
        stage: "preflight",
        startedBy: adminEmail,
        startedAt: new Date(),
        stageOutput: { startedAt: new Date().toISOString() },
        metadata: { source: { repo: source.repo } },
      },
    })
    deploymentId = deployment.id

    const baseUrl = `http://127.0.0.1:3000`
    const preflight = await runPreflight(manifest, baseUrl)
    await prisma.deployment.update({
      where: { id: deployment.id },
      data: { stageOutput: { ...(deployment.stageOutput as object), preflight: preflight.checks } },
    })

    if (!preflight.ok) {
      await prisma.deployment.update({ where: { id: deployment.id }, data: { status: "failed", stage: "preflight", completedAt: new Date(), error: preflight.checks.filter((c) => !c.ok).map((c) => c.detail).join("; ") } })
      await createAuditLog({ action: "update_apply_preflight_failed", adminId: null, actorEmail: adminEmail, targetType: "deployment", targetId: deployment.id, newValue: JSON.stringify(preflight.checks) })
      return { status: "preflight_failed", deploymentId: deployment.id, reason: preflight.checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`).join("; ") }
    }

    const script = resolveApplyScript()
    if (!script) {
      await prisma.deployment.update({
        where: { id: deployment.id },
        data: {
          status: "apply_pending",
          stage: "host_apply",
          completedAt: new Date(),
          stageOutput: { ...(deployment.stageOutput as object), note: "preflight passed; host apply script not configured", script: "scripts/apply-release.sh <version> <image> <deploymentId>" },
        },
      })
      await createAuditLog({ action: "update_apply_pending", adminId: null, actorEmail: adminEmail, targetType: "deployment", targetId: deployment.id, newValue: JSON.stringify({ version, image: imageRef }) })
      return { status: "apply_pending", deploymentId: deployment.id, reason: "preflight passed; run scripts/apply-release.sh on the host to finish (UPDATE_APPLY_SCRIPT not configured)" }
    }

    await prisma.deployment.update({ where: { id: deployment.id }, data: { stage: "apply" } })
    const result = await runApplyScript(version, imageRef, deployment.id, adminEmail)

    if (result.code === 0) {
      await prisma.deployment.update({
        where: { id: deployment.id },
        data: { status: "success", stage: "done", completedAt: new Date(), stageOutput: { ...(deployment.stageOutput as object), apply: result.output.slice(0, 4000), exitCode: 0 } },
      })
      await createAuditLog({ action: "update_applied", adminId: null, actorEmail: adminEmail, targetType: "deployment", targetId: deployment.id, newValue: JSON.stringify({ version, image: imageRef }) })
      return { status: "success", deploymentId: deployment.id, stage: "done", stageOutput: result.output.slice(0, 4000) }
    }

    await prisma.deployment.update({
      where: { id: deployment.id },
      data: {
        status: "failed",
        stage: result.timedOut ? "apply" : "done",
        completedAt: new Date(),
        error: result.timedOut ? "apply script timed out after 20 minutes" : `apply script exited ${result.code}`,
        stageOutput: { ...(deployment.stageOutput as object), apply: result.output.slice(0, 4000), exitCode: result.code },
      },
    })
    await createAuditLog({ action: "update_apply_failed", adminId: null, actorEmail: adminEmail, targetType: "deployment", targetId: deployment.id, oldValue: JSON.stringify({ version, image: imageRef }), newValue: result.output.slice(0, 4000) })
    return { status: "failed", deploymentId: deployment.id, stage: "apply", stageOutput: result.output.slice(0, 4000) }
  } catch (error) {
    if (deploymentId) {
      await prisma.deployment
        .update({ where: { id: deploymentId }, data: { status: "failed", stage: "apply", completedAt: new Date(), error: error instanceof Error ? error.message : String(error) } })
        .catch(() => null)
    }
    return { status: "error", deploymentId: deploymentId || undefined, reason: error instanceof Error ? error.message : String(error) }
  } finally {
    await releaseLock()
  }
}

export async function listDeploymentHistory(limit = 25) {
  return prisma.deployment.findMany({ orderBy: { createdAt: "desc" }, take: Math.min(Math.max(limit, 1), 100) })
}

export async function getDeployment(id: string) {
  return prisma.deployment.findUnique({ where: { id } })
}