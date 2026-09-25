import { parseSemver, compareSemver } from "@/lib/build-info"

/**
 * Admin Update Center — trusted-release source (Part 34 / Problem E).
 *
 * Releases are read from a GitHub repo configured ONLY via environment
 * (`UPDATE_GITHUB_REPO=owner/repo`). No free-form admin input ever reaches
 * GitHub or the apply path. A release is only offered to the admin when it:
 *   1. has a semver tag (`v1.2.0` or `1.2.0`),
 *   2. ships a `release-manifest.json` that passes strict validation
 *      (version matches the tag, image matches the configured allowlist,
 *      digest is a real sha256, migrations are safe identifiers).
 * Anything else is excluded and never executed.
 */

export type UpdateSourceConfig = {
  repo: string | null
  token: string | null
  imagePrefix: string
  enabled: boolean
}

export type ReleaseManifest = {
  version: string
  image: string
  digest: string | null
  migrations: string[]
  minVersion: string | null
  changelog: string | null
  requiredEnv: string[]
}

export type TrustedRelease = {
  tagName: string
  publishedAt: string | null
  manifest: ReleaseManifest
  invalidReason: string | null
}

export function getUpdateSource(): UpdateSourceConfig {
  const repo = String(process.env.UPDATE_GITHUB_REPO || "").trim() || null
  const token = String(process.env.UPDATE_GITHUB_TOKEN || "").trim() || null
  const imagePrefix = String(process.env.UPDATE_IMAGE_PREFIX || "zws-cloud").trim()
  return { repo, token, imagePrefix, enabled: Boolean(repo) }
}

const GITHUB_API = "https://api.github.com"
const RAW_BASE = "https://raw.githubusercontent.com"

async function ghFetch(url: string, source: UpdateSourceConfig, init: RequestInit = {}): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "zws-cloud-update-center",
    ...(init.headers as Record<string, string> | undefined),
  }
  if (source.token) headers.Authorization = `Bearer ${source.token}`
  return fetch(url, { ...init, headers, cache: "no-store", signal: AbortSignal.timeout(10_000) })
}

export function isValidDigest(value: unknown): value is string {
  if (typeof value !== "string") return false
  return /^sha256:[0-9a-f]{64}$/.test(value.trim())
}

export function isValidMigrationName(value: unknown): value is string {
  if (typeof value !== "string") return false
  if (value.length === 0 || value.length > 120) return false
  return /^[a-z0-9_]+$/.test(value)
}

/**
 * Strict validation of a release manifest. Returns the reason when invalid,
 * otherwise null. Nothing invalid can ever be applied.
 */
export function validateReleaseManifest(raw: unknown, tagName: string, source: UpdateSourceConfig): string | null {
  if (!raw || typeof raw !== "object") return "manifest is not an object"
  const manifest = raw as Record<string, unknown>

  const version = String(manifest.version || "").trim()
  if (!version) return "manifest missing version"
  const semver = parseSemver(version)
  if (!semver) return `manifest version "${version}" is not valid semver`

  const cleanTag = tagName.replace(/^v/, "")
  if (cleanTag !== version) return `tag ${tagName} does not match manifest version ${version}`

  const image = String(manifest.image || "").trim()
  if (!image) return "manifest missing image"
  if (!image.startsWith(`${source.imagePrefix}:`) && !image.startsWith(`${source.imagePrefix}@`)) {
    return `image "${image}" is not in the trusted prefix "${source.imagePrefix}"`
  }
  // Image ref must not smuggle a path/repo segment the operator did not allow.
  if (image.includes("/")) return `image "${image}" contains an unapproved path segment`

  const digest = manifest.digest
  if (digest !== null && digest !== undefined && !isValidDigest(digest)) return "digest is not a valid sha256 reference"

  if (manifest.migrations !== undefined) {
    if (!Array.isArray(manifest.migrations)) return "migrations must be an array"
    for (const name of manifest.migrations) {
      if (!isValidMigrationName(name)) return `migration name "${String(name)}" is not a safe identifier`
    }
  }

  if (manifest.requiredEnv !== undefined) {
    if (!Array.isArray(manifest.requiredEnv)) return "requiredEnv must be an array"
    for (const key of manifest.requiredEnv) {
      if (typeof key !== "string" || !/^[A-Z0-9_]+$/.test(key)) return `requiredEnv entry "${String(key)}" is not a valid env var name`
    }
  }

  return null
}

async function fetchManifestForTag(tag: string, source: UpdateSourceConfig, commitSha?: string): Promise<unknown | null> {
  if (!source.repo) return null
  // Prefer the release's own commit sha (immutable) over the tag (mutable).
  const ref = commitSha || tag
  const url = `${RAW_BASE}/${source.repo}/${encodeURIComponent(ref)}/release-manifest.json`
  try {
    const response = await ghFetch(url, source)
    if (!response.ok) return null
    const text = await response.text()
    try {
      return JSON.parse(text)
    } catch {
      return null
    }
  } catch {
    return null
  }
}

type GitHubRelease = {
  tag_name?: string
  published_at?: string | null
  target_commitish?: string | null
}

/**
 * List releases from the configured GitHub repo, in published order (newest
 * first). Releases without a valid trusted manifest are included with an
 * `invalidReason` set so the UI can show *why* they are not applicable —
 * a verified release is never silently swapped, and an untrusted one is never
 * claimable.
 */
export async function listTrustedReleases(): Promise<{ releases: TrustedRelease[]; error: string | null }> {
  const source = getUpdateSource()
  if (!source.repo) return { releases: [], error: null }

  try {
    const response = await ghFetch(`${GITHUB_API}/repos/${source.repo}/releases?per_page=20`, source)
    if (!response.ok) {
      const detail = response.status === 404 ? "repo not found" : `GitHub returned HTTP ${response.status}`
      return { releases: [], error: `Update source unavailable (${detail})` }
    }
    const data = (await response.json()) as GitHubRelease[]
    if (!Array.isArray(data)) return { releases: [], error: "Update source returned an unexpected payload" }

    const releases: TrustedRelease[] = []
    for (const item of data) {
      const tagName = String(item.tag_name || "").trim()
      if (!tagName) continue
      const version = tagName.replace(/^v/, "")
      if (!parseSemver(version)) continue

      const rawManifest = await fetchManifestForTag(tagName, source, item.target_commitish || undefined)
      if (!rawManifest) {
        releases.push({
          tagName,
          publishedAt: item.published_at || null,
          manifest: {
            version,
            image: "",
            digest: null,
            migrations: [],
            minVersion: null,
            changelog: null,
            requiredEnv: [],
          },
          invalidReason: "release has no release-manifest.json at its commit",
        })
        continue
      }

      const invalidReason = validateReleaseManifest(rawManifest, tagName, source)
      const manifest = rawManifest as ReleaseManifest
      releases.push({
        tagName,
        publishedAt: item.published_at || null,
        manifest: {
          version: String(manifest.version || "").trim(),
          image: String(manifest.image || "").trim(),
          digest: manifest.digest && isValidDigest(manifest.digest) ? String(manifest.digest).trim() : null,
          migrations: Array.isArray(manifest.migrations) ? manifest.migrations.filter(isValidMigrationName) : [],
          minVersion: typeof manifest.minVersion === "string" && parseSemver(manifest.minVersion) ? String(manifest.minVersion).trim() : null,
          changelog: typeof manifest.changelog === "string" ? String(manifest.changelog).slice(0, 4000) : null,
          requiredEnv: Array.isArray(manifest.requiredEnv) ? manifest.requiredEnv.filter((k) => typeof k === "string" && /^[A-Z0-9_]+$/.test(k)) : [],
        },
        invalidReason,
      })
    }
    releases.sort((a, b) => compareSemver(b.manifest.version, a.manifest.version))
    return { releases, error: null }
  } catch (error) {
    return { releases: [], error: error instanceof Error ? error.message : "Update source unreachable" }
  }
}

export function hasNewerRelease(currentVersion: string, releases: TrustedRelease[]): boolean {
  return releases.some((r) => !r.invalidReason && compareSemver(r.manifest.version, currentVersion) > 0)
}