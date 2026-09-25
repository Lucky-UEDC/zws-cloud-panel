import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

/**
 * Build identity (Part 13). At image build time the Dockerfile writes
 * /app/runtime-info.json with the version, source commit (or deterministic
 * source fingerprint) and build timestamp. At runtime this module resolves the
 * SAME identity for the version endpoint, the admin header, and the Update
 * Center — env vars take precedence, then the baked file, then package.json.
 */

export const APP_DEFAULT_VERSION = "1.1.0"

export type BuildInfo = {
  version: string
  commit: string | null
  builtAt: string | null
  image: string
  source: "runtime-info" | "env" | "package"
}

const CANDIDATE_PATHS = [
  () => path.join(process.cwd(), "runtime-info.json"),
  () => "/app/runtime-info.json",
  () => path.join(process.cwd(), ".next", "standalone", "runtime-info.json"),
]

export function getBuildInfo(): BuildInfo {
  for (const resolvePath of CANDIDATE_PATHS) {
    try {
      const filePath = resolvePath()
      if (!existsSync(filePath)) continue
      const data = JSON.parse(readFileSync(filePath, "utf8")) as Record<string, unknown>
      if (!data || typeof data.version !== "string") continue
      return {
        version: String(data.version) || APP_DEFAULT_VERSION,
        commit: typeof data.commit === "string" && data.commit ? data.commit : null,
        builtAt: typeof data.builtAt === "string" && data.builtAt ? data.builtAt : null,
        image: typeof data.image === "string" && data.image ? data.image : "zws-cloud",
        source: "runtime-info",
      }
    } catch {
      // try next candidate
    }
  }

  if (process.env.APP_VERSION) {
    return {
      version: process.env.APP_VERSION,
      commit: process.env.APP_COMMIT || null,
      builtAt: process.env.APP_SOURCE_DATE || null,
      image: process.env.APP_IMAGE || "zws-cloud",
      source: "env",
    }
  }

  return { version: APP_DEFAULT_VERSION, commit: null, builtAt: null, image: "zws-cloud", source: "package" }
}

export function parseSemver(value: string): { major: number; minor: number; patch: number } | null {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(String(value || "").trim())
  if (!match) return null
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) }
}

export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a)
  const pb = parseSemver(b)
  if (!pa || !pb) return String(a).localeCompare(String(b))
  for (const key of ["major", "minor", "patch"] as const) {
    if (pa[key] !== pb[key]) return pa[key] - pb[key]
  }
  return 0
}