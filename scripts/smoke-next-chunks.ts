import { publicOrigin } from "../lib/public-url"
import fs from "node:fs"
import nodePath from "node:path"

const baseUrl = process.env.SMOKE_BASE_URL || publicOrigin()
const smokePath = process.env.SMOKE_PATH || "/offer/ad-4vcpu-16gb-499"
const root = process.cwd()
const authCookie = process.env.SMOKE_AUTH_COOKIE || process.env.FRONTEND_VERIFY_COOKIE || ""

function smokeHeaders(extra: Record<string, string> = {}) {
  return {
    "User-Agent": "zws-chunk-smoke/1.0",
    ...(authCookie ? { Cookie: authCookie } : {}),
    ...extra,
  }
}

function absoluteUrl(nextPath: string) {
  return new URL(nextPath, baseUrl).toString()
}

async function fetchText(url: string) {
  const response = await fetch(url, { headers: smokeHeaders() })
  const text = await response.text()
  return { response, text }
}

async function main() {
  if (!process.env.SMOKE_BASE_URL && process.env.SMOKE_HTTP !== "1") {
    const staticDir = nodePath.join(root, ".next", "static")
    const standaloneStaticDir = nodePath.join(root, ".next", "standalone", ".next", "static")
    const buildManifest = nodePath.join(root, ".next", "build-manifest.json")
    const appBuildManifest = nodePath.join(root, ".next", "app-build-manifest.json")
    const missing: string[] = []

    for (const file of [nodePath.join(root, ".next", "BUILD_ID"), buildManifest]) {
      if (!fs.existsSync(file)) missing.push(nodePath.relative(root, file))
    }
    for (const dir of [staticDir, standaloneStaticDir]) {
      if (!fs.existsSync(dir)) missing.push(nodePath.relative(root, dir))
    }
    if (missing.length) throw new Error(`Chunk smoke missing build artifacts:\n${missing.join("\n")}`)

    const files: string[] = []
    const stack = [staticDir, standaloneStaticDir]
    while (stack.length) {
      const current = stack.pop()!
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const full = nodePath.join(current, entry.name)
        if (entry.isDirectory()) stack.push(full)
        else files.push(full)
      }
    }

    const css = files.filter((file) => file.endsWith(".css"))
    const js = files.filter((file) => file.endsWith(".js"))
    if (!css.length) throw new Error("Chunk smoke found no generated CSS chunks")
    if (!js.length) throw new Error("Chunk smoke found no generated JS chunks")

    const manifestText = [
      buildManifest,
      appBuildManifest,
      nodePath.join(root, ".next", "server", "server-reference-manifest.json"),
    ].filter((file) => fs.existsSync(file))
      .map((file) => fs.readFileSync(file, "utf8"))
      .join("\n")
    const referenced = Array.from(manifestText.matchAll(/static\/(?:chunks|css)\/[^"]+\.(?:js|css)/g)).map((match) => match[0])
    const missingReferenced = referenced.filter((asset) => !fs.existsSync(nodePath.join(root, ".next", asset)))
    if (missingReferenced.length) {
      throw new Error(`Chunk smoke found manifest references without files:\n${missingReferenced.join("\n")}`)
    }

    console.log(`Chunk smoke passed for build artifacts: ${css.length} CSS chunks, ${js.length} JS chunks`)
    return
  }

  const pageUrl = absoluteUrl(smokePath)
  const page = await fetchText(pageUrl)
  if (!page.response.ok) {
    throw new Error(`Page returned ${page.response.status}: ${pageUrl}`)
  }

  const chunks = Array.from(page.text.matchAll(/["'](\/_next\/static\/chunks\/[^"']+?\.js)["']/g))
    .map((match) => match[1])
  const uniqueChunks = Array.from(new Set(chunks))
  if (!uniqueChunks.length) {
    throw new Error(`No Next.js chunks found on ${pageUrl}`)
  }

  const failed: string[] = []
  for (const chunk of uniqueChunks) {
    const url = absoluteUrl(chunk)
    const response = await fetch(url, { method: "HEAD", headers: smokeHeaders() })
    if (!response.ok) {
      failed.push(`${response.status} ${chunk}`)
    }
  }

  if (failed.length) {
    throw new Error(`Chunk smoke failed:\n${failed.join("\n")}`)
  }

  console.log(`Chunk smoke passed for ${pageUrl}: ${uniqueChunks.length} chunks checked`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
