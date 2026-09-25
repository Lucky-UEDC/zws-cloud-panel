const fs = require("fs")
const path = require("path")

function copyDir(from, to) {
  if (!fs.existsSync(from)) return false
  fs.mkdirSync(to, { recursive: true })
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name)
    const target = path.join(to, entry.name)
    if (entry.isDirectory()) copyDir(source, target)
    else if (entry.isSymbolicLink()) {
      const link = fs.readlinkSync(source)
      try { fs.symlinkSync(link, target) } catch {
        fs.rmSync(target, { force: true, recursive: true })
        fs.symlinkSync(link, target)
      }
    } else fs.copyFileSync(source, target)
  }
  return true
}

function rm(target) {
  fs.rmSync(target, { force: true, recursive: true })
}

function fail(message) {
  throw new Error(`[copy-standalone-assets] ${message}`)
}

function requireFile(file) {
  if (!fs.existsSync(file)) fail(`${file} is missing`)
}

function requireJson(file) {
  requireFile(file)
  try {
    JSON.parse(fs.readFileSync(file, "utf8"))
  } catch {
    fail(`${file} is not valid JSON`)
  }
}

function listFiles(dir, predicate) {
  const files = []
  if (!fs.existsSync(dir)) return files
  const stack = [dir]
  while (stack.length) {
    const current = stack.pop()
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) stack.push(full)
      else if (!predicate || predicate(full)) files.push(full)
    }
  }
  return files
}

function requireGeneratedChunks(dir, label) {
  const css = listFiles(dir, (file) => file.endsWith(".css"))
  const js = listFiles(dir, (file) => file.endsWith(".js"))
  if (!css.length) fail(`${label} has no generated CSS chunks`)
  if (!js.length) fail(`${label} has no generated JS chunks`)
}

function requireClientReferenceManifests(dir, label) {
  const manifests = listFiles(dir, (file) => file.endsWith("_client-reference-manifest.js"))
  if (!manifests.length) fail(`${label} has no client reference manifests`)
}

function mergePreviousStaticAssets() {
  const previous = path.join(".next-static-previous")
  if (!fs.existsSync(previous)) return
  copyDir(previous, path.join(".next", "static"))
  console.log("[copy-standalone-assets] merged previous static chunks")
}

const standalone = path.join(".next", "standalone")
mergePreviousStaticAssets()
requireFile(path.join(".next", "BUILD_ID"))
requireJson(path.join(".next", "build-manifest.json"))
requireJson(path.join(".next", "app-path-routes-manifest.json"))
requireJson(path.join(".next", "server", "app-paths-manifest.json"))
requireFile(path.join(".next", "server", "server-reference-manifest.js"))
requireJson(path.join(".next", "server", "server-reference-manifest.json"))
requireClientReferenceManifests(path.join(".next", "server", "app"), ".next/server/app")
for (const optionalManifest of [
  path.join(".next", "app-build-manifest.json"),
  path.join(".next", "routes-manifest.json"),
  path.join(".next", "prerender-manifest.json"),
]) {
  if (fs.existsSync(optionalManifest)) requireJson(optionalManifest)
}
requireGeneratedChunks(path.join(".next", "static"), ".next/static")
requireFile(path.join(standalone, "server.js"))

rm(path.join(standalone, ".env"))
for (const file of fs.readdirSync(standalone)) {
  if (file.startsWith(".env.")) rm(path.join(standalone, file))
}

fs.mkdirSync(path.join(standalone, ".next"), { recursive: true })
rm(path.join(standalone, ".next", "static"))
copyDir(path.join(".next", "static"), path.join(standalone, ".next", "static"))
requireGeneratedChunks(path.join(standalone, ".next", "static"), ".next/standalone/.next/static")
rm(path.join(standalone, "public"))
copyDir("public", path.join(standalone, "public"))

const pnpmDir = path.join("node_modules", ".pnpm")
const standalonePnpm = path.join(standalone, "node_modules", ".pnpm")
function copyPnpmPackage(encodedPrefix, packagePath) {
  const matches = fs.readdirSync(pnpmDir).filter((name) => name.startsWith(encodedPrefix)).sort()
  const selected = matches.at(-1)
  if (!selected) return false
  const source = path.join(pnpmDir, selected)
  const target = path.join(standalonePnpm, selected)
  copyDir(source, target)
  const linkPath = path.join(standalone, "node_modules", ...packagePath.split("/"))
  fs.mkdirSync(path.dirname(linkPath), { recursive: true })
  rm(linkPath)
  fs.symlinkSync(path.relative(path.dirname(linkPath), path.join(target, "node_modules", ...packagePath.split("/"))), linkPath)
  return true
}

const copiedPackages = new Set()
function encodedPrefixForPackage(packagePath) {
  return packagePath.startsWith("@") ? `${packagePath.replace("/", "+")}@` : `${packagePath}@`
}

function findPackageJson(packagePath) {
  const direct = path.join("node_modules", ...packagePath.split("/"), "package.json")
  if (fs.existsSync(direct)) return direct
  const encodedPrefix = encodedPrefixForPackage(packagePath)
  const matches = fs.readdirSync(pnpmDir).filter((name) => name.startsWith(encodedPrefix)).sort()
  const selected = matches.at(-1)
  if (!selected) return null
  const candidate = path.join(pnpmDir, selected, "node_modules", ...packagePath.split("/"), "package.json")
  return fs.existsSync(candidate) ? candidate : null
}

function copyPnpmPackageWithDependencies(packagePath) {
  if (copiedPackages.has(packagePath)) return true
  copiedPackages.add(packagePath)
  if (!copyPnpmPackage(encodedPrefixForPackage(packagePath), packagePath)) return false

  const packageJson = findPackageJson(packagePath)
  if (!packageJson) return true
  const metadata = JSON.parse(fs.readFileSync(packageJson, "utf8"))
  for (const dependency of Object.keys(metadata.dependencies || {})) {
    copyPnpmPackageWithDependencies(dependency)
  }
  return true
}

for (const packagePath of [
  "next",
  "react",
  "react-dom",
  "@swc/helpers",
  "@next/env",
  "styled-jsx",
  "postcss",
  "nanoid",
  "client-only",
  "server-only",
  "puppeteer",
  "puppeteer-core",
  "@puppeteer/browsers",
  "chromium-bidi",
  "devtools-protocol",
  "proxy-agent",
  "extract-zip",
  "tar-fs",
  "progress",
  "cosmiconfig",
  "yargs",
]) {
  copyPnpmPackageWithDependencies(packagePath)
}

requireFile(path.join(".next", "BUILD_ID"))
requireGeneratedChunks(path.join(standalone, ".next", "static"), ".next/standalone/.next/static")
requireClientReferenceManifests(path.join(standalone, ".next", "server", "app"), ".next/standalone/.next/server/app")
console.log("[copy-standalone-assets] standalone runtime assets verified")
