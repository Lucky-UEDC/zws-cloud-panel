import fs from "node:fs"
import path from "node:path"

type Issue = { file: string; line: number; target: string; reason: string }

const root = process.cwd()
const sourceRoots = ["app", "components", "lib"].filter((dir) => fs.existsSync(path.join(root, dir)))
const extensions = new Set([".ts", ".tsx", ".js", ".jsx"])
const ignored = new Set([".git", ".next", "node_modules"])
const issues: Issue[] = []

function rel(file: string) {
  return path.relative(root, file).replaceAll(path.sep, "/")
}

function walk(dir: string, files: string[] = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, files)
    else if (extensions.has(path.extname(entry.name))) files.push(full)
  }
  return files
}

function routeFromFile(file: string) {
  const relative = rel(file)
  if (!relative.startsWith("app/")) return null
  if (!/(^|\/)(page|route)\.(tsx?|jsx?)$/.test(relative)) return null
  let route = relative
    .replace(/^app/, "")
    .replace(/\/(page|route)\.(tsx?|jsx?)$/, "")
    .replace(/\/\([^/]+\)/g, "")
  if (!route) route = "/"
  return route
}

function cleanTarget(target: string) {
  const value = target.trim()
  if (!value || value === "#") return value
  if (!value.startsWith("/") || value.startsWith("//")) return ""
  return (value.split("#")[0]?.split("?")[0] || "/").replace(/\/+$/, "") || "/"
}

function patternFor(route: string) {
  const escaped = route
    .replace(/\/\[\[\.\.\.[^\]]+\]\]/g, "(?:/.*)?")
    .replace(/\/\[\.\.\.[^\]]+\]/g, "/.*")
    .replace(/\[[^\]]+\]/g, "[^/]+")
    .replace(/\//g, "\\/")
  return new RegExp(`^${escaped}$`)
}

function hasRoute(target: string, routes: Set<string>, patterns: RegExp[]) {
  if (routes.has(target)) return true
  return patterns.some((pattern) => pattern.test(target))
}

function lineNumber(text: string, index: number) {
  return text.slice(0, index).split(/\r?\n/).length
}

function collectTargets(file: string, text: string) {
  const found: Array<{ target: string; index: number }> = []
  const patterns = [
    /\bhref\s*=\s*["']([^"']+)["']/g,
    /\bhref\s*=\s*\{\s*["']([^"']+)["']\s*\}/g,
    /\b(?:router\.)?(?:push|replace)\(\s*["']([^"']+)["']/g,
    /\b(?:window\.location\.assign|globalThis\.location\.assign)\(\s*["']([^"']+)["']/g,
    /\bfetch\(\s*["']([^"']+)["']/g,
  ]
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) found.push({ target: match[1] || "", index: match.index || 0 })
  }
  return found
}

const files = sourceRoots.flatMap((dir) => walk(path.join(root, dir)))
const pageRoutes = new Set<string>()
const apiRoutes = new Set<string>()
for (const file of files) {
  const route = routeFromFile(file)
  if (!route) continue
  if (rel(file).endsWith("/route.ts") || rel(file).endsWith("/route.js")) apiRoutes.add(route)
  else pageRoutes.add(route)
}

const allRoutes = new Set([...pageRoutes, ...apiRoutes])
const pagePatterns = [...pageRoutes].map(patternFor)
const apiPatterns = [...apiRoutes].map(patternFor)
const allPatterns = [...allRoutes].map(patternFor)

for (const file of files) {
  const text = fs.readFileSync(file, "utf8")
  for (const { target, index } of collectTargets(file, text)) {
    if (target.includes("${") || target.includes("`")) continue
    const clean = cleanTarget(target)
    if (!clean) continue
    if (clean === "#") {
      issues.push({ file: rel(file), line: lineNumber(text, index), target, reason: "placeholder link" })
      continue
    }
    const isApi = clean.startsWith("/api/")
    const ok = isApi ? hasRoute(clean, apiRoutes, apiPatterns) : hasRoute(clean, allRoutes, allPatterns)
    if (!ok) {
      issues.push({ file: rel(file), line: lineNumber(text, index), target, reason: isApi ? "missing API route" : "missing page route" })
    }
  }
}

const required = ["/admin/backups", "/admin/support", "/client-area/support", "/api/admin/backups", "/api/tickets/attachments/[id]"]
for (const route of required) {
  if (!hasRoute(route, allRoutes, allPatterns)) {
    issues.push({ file: "route-manifest", line: 1, target: route, reason: "required route missing" })
  }
}

if (issues.length) {
  console.error(`Found ${issues.length} internal route issue(s):`)
  for (const issue of issues) console.error(`- ${issue.file}:${issue.line} ${issue.target} (${issue.reason})`)
  process.exit(1)
}

console.log(`Validated ${allRoutes.size} app/API routes and internal static links.`)
