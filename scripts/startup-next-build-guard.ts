import fs from "node:fs"
import path from "node:path"

const root = process.cwd()

function fail(message: string): never {
  console.error(`[startup-next-build-guard] ${message}`)
  process.exit(1)
}

function readJson(file: string) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, file), "utf8"))
  } catch {
    return null
  }
}

function requireFile(file: string) {
  if (!fs.existsSync(path.join(root, file))) fail(`${file} is missing`)
}

function listFiles(dir: string, extension: string) {
  const fullDir = path.join(root, dir)
  const files: string[] = []
  if (!fs.existsSync(fullDir)) return files
  const stack = [fullDir]
  while (stack.length) {
    const current = stack.pop()!
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) stack.push(full)
      else if (full.endsWith(extension)) files.push(full)
    }
  }
  return files
}

const buildIdFile = path.join(root, ".next/BUILD_ID")
if (!fs.existsSync(buildIdFile)) fail(".next/BUILD_ID is missing")
const buildId = fs.readFileSync(buildIdFile, "utf8").trim()
if (!buildId) fail(".next/BUILD_ID is empty")

const manifests = [
  ".next/build-manifest.json",
  ".next/server/app-paths-manifest.json",
]

for (const manifest of manifests) {
  requireFile(manifest)
  if (!readJson(manifest)) fail(`${manifest} is invalid JSON`)
}

for (const manifest of [".next/app-path-routes-manifest.json", ".next/prerender-manifest.json", ".next/routes-manifest.json"]) {
  if (fs.existsSync(path.join(root, manifest)) && !readJson(manifest)) fail(`${manifest} is invalid JSON`)
}

const cssChunks = listFiles(".next/static", ".css")
const jsChunks = listFiles(".next/static", ".js")
if (!cssChunks.length) fail("no CSS chunks found in .next/static")
if (!jsChunks.length) fail("no JS chunks found in .next/static")

const clientReferenceManifests = listFiles(".next/server/app", "_client-reference-manifest.js")
if (!clientReferenceManifests.length) fail("no client reference manifests found in .next/server/app")
requireFile(".next/server/server-reference-manifest.js")
if (!readJson(".next/server/server-reference-manifest.json")) fail(".next/server/server-reference-manifest.json is missing or invalid JSON")

if (process.env.REQUIRE_STANDALONE_STATIC === "1") {
  if (!fs.existsSync(path.join(root, ".next/standalone/server.js"))) {
    fail("standalone server is required but .next/standalone/server.js is missing")
  }
  const standaloneCss = listFiles(".next/standalone/.next/static", ".css")
  const standaloneJs = listFiles(".next/standalone/.next/static", ".js")
  if (!standaloneCss.length) fail("standalone runtime is missing CSS chunks")
  if (!standaloneJs.length) fail("standalone runtime is missing JS chunks")
  const standaloneClientReferenceManifests = listFiles(".next/standalone/.next/server/app", "_client-reference-manifest.js")
  if (!standaloneClientReferenceManifests.length) fail("standalone runtime is missing client reference manifests")
  if (!fs.existsSync(path.join(root, ".next/standalone/node_modules/@swc/helpers"))) {
    fail("standalone runtime is missing @swc/helpers")
  }
  if (!fs.existsSync(path.join(root, ".next/standalone/node_modules/@next/env"))) {
    fail("standalone runtime is missing @next/env")
  }
}

console.log(`[startup-next-build-guard] Next build ok (${buildId})`)
