import fs from "node:fs"
import path from "node:path"

type ProblemLevel = "error" | "warning"

type Problem = {
  level: ProblemLevel
  message: string
}

const root = process.cwd()
const requiredAdminRoutes = [
  "/admin/orders",
  "/admin/revenue",
  "/admin/vms",
  "/admin/customers",
  "/admin/settings",
  "/admin/integrations",
  "/admin/provision-queue",
  "/admin/backups",
  "/admin/support",
  "/client-area/support",
]

const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".css"])
const ignoredDirs = new Set([".git", ".next", "node_modules", "logs", ".wwebjs_auth", ".wwebjs_cache", "backups", "current", "releases"])
const problems: Problem[] = []

function rel(file: string) {
  return path.relative(root, file).replaceAll(path.sep, "/")
}

function add(level: ProblemLevel, message: string) {
  problems.push({ level, message })
}

function readText(file: string) {
  return fs.readFileSync(file, "utf8")
}

function exists(file: string) {
  return fs.existsSync(path.join(root, file))
}

function readJson<T = any>(file: string): T | null {
  try {
    return JSON.parse(readText(path.join(root, file))) as T
  } catch {
    return null
  }
}

function walk(dir: string, output: string[] = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignoredDirs.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(full, output)
    } else if (sourceExtensions.has(path.extname(entry.name))) {
      output.push(full)
    }
  }
  return output
}

function countMatches(text: string, pattern: RegExp) {
  return Array.from(text.matchAll(pattern)).length
}

function checkCssEntrypoints(files: string[]) {
  const globalCssImports: string[] = []
  const tailwindEntrypoints: string[] = []

  for (const file of files) {
    const text = readText(file)
    const relative = rel(file)
    if (/\bimport\s+["'][^"']*globals\.css["']/.test(text)) {
      globalCssImports.push(relative)
    }
    if (/@import\s+["']tailwindcss["']|@tailwind\s+(base|components|utilities)/.test(text)) {
      tailwindEntrypoints.push(relative)
    }
    if (
      relative !== "app/layout.tsx" &&
      /\.(tsx?|jsx?)$/.test(relative) &&
      /\bimport\s+["'][^"']+\.css["']/.test(text)
    ) {
      add("error", `${relative} imports CSS outside app/layout.tsx`)
    }
  }

  if (globalCssImports.length !== 1 || globalCssImports[0] !== "app/layout.tsx") {
    add("error", `globals.css must be imported exactly once from app/layout.tsx; found ${globalCssImports.join(", ") || "none"}`)
  }
  if (tailwindEntrypoints.length !== 1 || tailwindEntrypoints[0] !== "app/globals.css") {
    add("error", `Tailwind must have exactly one entrypoint in app/globals.css; found ${tailwindEntrypoints.join(", ") || "none"}`)
  }

  const globals = exists("app/globals.css") ? readText(path.join(root, "app/globals.css")) : ""
  const tailwindImports = countMatches(globals, /@import\s+["']tailwindcss["']|@tailwind\s+(base|components|utilities)/g)
  if (tailwindImports !== 1) {
    add("error", `app/globals.css must contain exactly one Tailwind entry directive/import; found ${tailwindImports}`)
  }
}

function checkAdminShell(files: string[]) {
  const adminLayouts = files.filter((file) => rel(file).startsWith("app/admin/") && path.basename(file) === "layout.tsx")
  if (adminLayouts.length !== 1 || rel(adminLayouts[0]) !== "app/admin/layout.tsx") {
    add("error", `Expected only app/admin/layout.tsx as admin layout; found ${adminLayouts.map(rel).join(", ") || "none"}`)
  }

  const adminSidebarRenders: string[] = []
  const panelShellRenders: string[] = []
  const forbiddenProviders = ["LayoutWrapper", "SidebarProvider", "ThemeProvider", "QueryProvider", "TooltipProvider"]

  for (const file of files) {
    const relative = rel(file)
    if (!relative.startsWith("app/") && !relative.startsWith("components/")) continue
    const text = readText(file)
    if (/<AdminSidebar\b/.test(text)) adminSidebarRenders.push(relative)
    if (/<PanelShell\b/.test(text) && relative.startsWith("app/admin/")) panelShellRenders.push(relative)
    if (relative === "app/admin/layout.tsx") {
      for (const provider of forbiddenProviders) {
        if (new RegExp(`<${provider}\\b`).test(text)) {
          add("error", `app/admin/layout.tsx must not mount duplicate ${provider}`)
        }
      }
    }
  }

  if (adminSidebarRenders.length !== 1 || adminSidebarRenders[0] !== "app/admin/layout.tsx") {
    add("error", `AdminSidebar must render exactly once from app/admin/layout.tsx; found ${adminSidebarRenders.join(", ") || "none"}`)
  }
  if (panelShellRenders.length !== 1 || panelShellRenders[0] !== "app/admin/layout.tsx") {
    add("error", `PanelShell for admin must render exactly once from app/admin/layout.tsx; found ${panelShellRenders.join(", ") || "none"}`)
  }
}

function listStaticFiles(dir: string) {
  const files: string[] = []
  if (!fs.existsSync(dir)) return files
  const stack = [dir]
  while (stack.length) {
    const current = stack.pop()!
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) stack.push(full)
      else files.push(full)
    }
  }
  return files
}

function checkNextBuild() {
  if (!exists(".next/BUILD_ID")) {
    add("error", ".next/BUILD_ID is missing; run pnpm build before verify:frontend")
    return
  }

  const buildId = readText(path.join(root, ".next/BUILD_ID")).trim()
  if (!buildId) add("error", ".next/BUILD_ID is empty")

  const manifests = [
    ".next/build-manifest.json",
    ".next/app-path-routes-manifest.json",
    ".next/prerender-manifest.json",
    ".next/routes-manifest.json",
    ".next/server/app-paths-manifest.json",
  ]
  for (const manifest of manifests) {
    if (!exists(manifest)) {
      add("error", `${manifest} is missing`)
    } else if (!readJson(manifest)) {
      add("error", `${manifest} is not valid JSON`)
    }
  }

  const routes = readJson<Record<string, string>>(".next/app-path-routes-manifest.json")
  if (routes) {
    const routeValues = new Set(Object.values(routes))
    for (const route of requiredAdminRoutes) {
      if (!routeValues.has(route)) add("error", `required admin route is missing from app-path-routes-manifest: ${route}`)
    }
  }

  const staticFiles = listStaticFiles(path.join(root, ".next/static"))
  const cssChunks = staticFiles.filter((file) => file.endsWith(".css"))
  const jsChunks = staticFiles.filter((file) => file.endsWith(".js"))
  if (!cssChunks.length) add("error", "No generated CSS chunks found in .next/static")
  if (!jsChunks.length) add("error", "No generated JS chunks found in .next/static")

  const standaloneStatic = path.join(root, ".next/standalone/.next/static")
  if (process.env.FRONTEND_VERIFY_STANDALONE === "1" && !fs.existsSync(standaloneStatic)) {
    add("error", ".next/standalone/.next/static is missing")
  } else if (fs.existsSync(path.join(root, ".next/standalone")) && !fs.existsSync(standaloneStatic)) {
    add("warning", ".next/standalone exists without copied static assets; deploy verification runs with FRONTEND_VERIFY_STANDALONE=1 after asset copy")
  }
}

function checkOptionalBrowserInputs() {
  if (!process.env.FRONTEND_VERIFY_COOKIE && !process.env.FRONTEND_VERIFY_EMAIL) {
    console.log("[verify:frontend] authenticated admin browser smoke checks skipped; set FRONTEND_VERIFY_COOKIE or deploy test credentials to enable them")
  }
}

const files = walk(root)
checkCssEntrypoints(files)
checkAdminShell(files)
checkNextBuild()
checkOptionalBrowserInputs()

const errors = problems.filter((problem) => problem.level === "error")
for (const problem of problems) {
  const prefix = problem.level === "error" ? "ERROR" : "WARN"
  console.log(`[verify:frontend] ${prefix}: ${problem.message}`)
}

if (errors.length) {
  console.error(`[verify:frontend] failed with ${errors.length} error(s)`)
  process.exit(1)
}

console.log("[verify:frontend] passed")
