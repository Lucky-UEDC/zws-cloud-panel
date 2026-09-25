import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"

function walk(dir: string, files: string[] = []) {
  if (!existsSync(dir)) return files
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) walk(full, files)
    else files.push(full)
  }
  return files
}

function readJson<T>(file: string): T | null {
  if (!existsSync(file)) return null
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T
  } catch {
    return null
  }
}

function fileSize(file: string) {
  try {
    return statSync(file).size
  } catch {
    return 0
  }
}

function main() {
  const buildManifest = readJson<Record<string, any>>(".next/build-manifest.json")
  const appManifest =
    readJson<Record<string, string[]>>(".next/app-build-manifest.json") ||
    readJson<Record<string, string>>(".next/app-path-routes-manifest.json")
  const chunks = walk(".next/static").filter((file) => /\.(js|css)$/.test(file)).map((file) => ({ file, bytes: fileSize(file) })).sort((a, b) => b.bytes - a.bytes)
  const sourceFiles = walk("app").concat(walk("components"), walk("lib")).filter((file) => /\.(tsx?|jsx?)$/.test(file))
  const duplicateFetches = new Map<string, number>()
  const hydrationHeavy = []
  const unusedImportHints = []

  for (const file of sourceFiles) {
    const source = readFileSync(file, "utf8")
    for (const match of source.matchAll(/fetch\((["'`])([^"'`]+)\1/g)) {
      const key = match[2]
      duplicateFetches.set(key, (duplicateFetches.get(key) || 0) + 1)
    }
    if (source.startsWith("\"use client\"") || source.startsWith("'use client'")) {
      const hooks = (source.match(/use(State|Effect|Memo|Callback|Ref)\(/g) || []).length
      const imports = (source.match(/^import /gm) || []).length
      if (hooks + imports >= 18) hydrationHeavy.push({ file, hooks, imports })
    }
    const importNames = Array.from(source.matchAll(/import\s+\{([^}]+)\}\s+from/g)).flatMap((match) => match[1].split(",").map((name) => name.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean))
    const maybeUnused = importNames.filter((name) => new RegExp(`\\b${name}\\b`, "g").test(source.replace(new RegExp(`import\\s+\\{[^}]*\\b${name}\\b[^}]*\\}\\s+from[^\\n]+`, "g"), "")) === false)
    if (maybeUnused.length) unusedImportHints.push({ file, imports: maybeUnused.slice(0, 12) })
  }

  const report = {
    generatedAt: new Date().toISOString(),
    buildManifestsPresent: Boolean(buildManifest && appManifest),
    largestAssets: chunks.slice(0, 25),
    largeJsBundles: chunks.filter((chunk) => chunk.file.endsWith(".js") && chunk.bytes > 250_000).slice(0, 25),
    duplicateFetches: Array.from(duplicateFetches.entries()).filter(([, count]) => count > 1).map(([url, count]) => ({ url, count })).sort((a, b) => b.count - a.count).slice(0, 40),
    hydrationHeavyPublicComponents: hydrationHeavy.filter((item) => !item.file.startsWith("app/admin") && !item.file.startsWith("app/client-area") && !item.file.startsWith("components/admin") && !item.file.startsWith("components/client")).slice(0, 40),
    unusedImportHints: unusedImportHints.slice(0, 40),
    routeBundleManifestKeys: appManifest ? Object.keys(appManifest).slice(0, 80) : [],
    recommendations: [
      "Keep admin/client/order/provisioning/runtime APIs no-store.",
      "Keep non-personalized marketing pages on ISR where they only read public settings.",
      "Lazy-load console transports and dashboard-only visualizations.",
      "Review duplicate fetch entries before adding new polling loops.",
    ],
  }

  console.log(JSON.stringify(report, null, 2))
}

main()
