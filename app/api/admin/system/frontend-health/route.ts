import fs from "node:fs"
import path from "node:path"
import { NextResponse } from "next/server"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { NO_CACHE_HEADERS } from "@/lib/http-cache"
import { getAdminFromCookies } from "@/lib/server-auth"

export const dynamic = "force-dynamic"
export const revalidate = 0

const requiredAdminRoutes = [
  "/admin/products",
  "/admin/customers",
  "/admin/orders",
  "/admin/vms",
  "/admin/settings",
  "/admin/integrations",
  "/admin/provision-queue",
  "/admin/revenue",
  "/admin/os-templates",
  "/admin/bandwidth",
  "/admin/system/frontend-health",
]

function appPath(...parts: string[]) {
  return path.join(/*turbopackIgnore: true*/ process.cwd(), ...parts)
}

function readJson(file: string) {
  try {
    return JSON.parse(fs.readFileSync(appPath(file), "utf8"))
  } catch {
    return null
  }
}

function listFiles(dir: string) {
  const fullDir = appPath(dir)
  const files: string[] = []
  if (!fs.existsSync(fullDir)) return files
  const stack = [fullDir]
  while (stack.length) {
    const current = stack.pop()!
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) stack.push(full)
      else files.push(full)
    }
  }
  return files.map((file) => `/${path.relative(appPath(".next/static"), file).replaceAll(path.sep, "/")}`)
}

function routeAppManifestKey(route: string) {
  return `${route}/page`
}

function routeServerFile(route: string, appPaths: Record<string, string> | null) {
  const value = appPaths?.[routeAppManifestKey(route)]
  return value ? `.next/server/${value}` : ""
}

export async function GET() {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401, headers: NO_CACHE_HEADERS })
  }

  const routes = readJson(".next/app-path-routes-manifest.json") as Record<string, string> | null
  const appPaths = readJson(".next/server/app-paths-manifest.json") as Record<string, string> | null
  const routeValues = new Set(routes ? Object.values(routes) : [])
  const routeKeys = new Set(routes ? Object.keys(routes) : [])
  const staticFiles = listFiles(".next/static")
  const cssChunks = staticFiles.filter((file) => file.endsWith(".css")).map((file) => `/_next/static${file}`)
  const jsChunks = staticFiles.filter((file) => file.endsWith(".js")).map((file) => `/_next/static${file}`)
  const manifests = [
    ".next/BUILD_ID",
    ".next/build-manifest.json",
    ".next/app-path-routes-manifest.json",
    ".next/prerender-manifest.json",
    ".next/routes-manifest.json",
    ".next/server/app-paths-manifest.json",
  ]
  const missingManifests = manifests.filter((file) => !fs.existsSync(appPath(file)))
  const invalidJsonManifests = manifests
    .filter((file) => file.endsWith(".json") && fs.existsSync(appPath(file)) && !readJson(file))
  const routeStatus = requiredAdminRoutes.map((route) => {
    const appManifestKey = routeAppManifestKey(route)
    const serverFile = routeServerFile(route, appPaths)
    return {
      route,
      inManifest: routeValues.has(route) || routeKeys.has(appManifestKey),
      appManifestKey,
      serverFile,
      serverFileExists: Boolean(serverFile && fs.existsSync(appPath(serverFile))),
    }
  })

  return NextResponse.json({
    success: true,
    checkedAt: new Date().toISOString(),
    manifests: {
      ready: !missingManifests.length && !invalidJsonManifests.length,
      routeStatus: routeStatus.map(({ route, inManifest, serverFileExists }) => ({ route, inManifest, serverFileExists })),
    },
    assets: {
      cssChunkCount: cssChunks.length,
      jsChunkCount: jsChunks.length,
      ready: Boolean(cssChunks.length && jsChunks.length),
    },
    layout: {
      expectedAdminShells: 1,
      expectedDesktopSidebars: 1,
      expectedMobileSidebars: 1,
      expectedPanelShells: 1,
    },
  }, { headers: NO_CACHE_HEADERS })
}
