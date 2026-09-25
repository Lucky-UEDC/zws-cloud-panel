import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { footerSections, primaryNav, publicSitemapRoutes } from "../lib/navigation"

type RouteKind = "public" | "admin" | "client" | "api"

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

function appRouteFromFile(file: string) {
  const relative = file.replace(/^app\//, "").replace(/(^|\/)(page|route)\.(tsx?|jsx?)$/, "")
  const segments = relative.split(path.sep).filter(Boolean).filter((segment) => !segment.startsWith("("))
  const route = `/${segments.join("/")}`.replace(/\/+/g, "/")
  return route === "/" ? "/" : route
}

function kindOf(route: string): RouteKind {
  if (route === "/api" || route.startsWith("/api/")) return "api"
  if (route === "/admin" || route.startsWith("/admin/")) return "admin"
  if (route === "/client-area" || route.startsWith("/client-area/")) return "client"
  return "public"
}

function normalize(route: string) {
  return route === "" ? "/" : route
}

function routePattern(route: string) {
  return route.replace(/\[[^\]]+\]/g, ":param")
}

function isUtilityPublicRoute(route: string) {
  return [
    "/403",
    "/account",
    "/checkout",
    "/dedicated/checkout",
    "/forgot-password",
    "/health",
    "/invoice",
    "/login",
    "/logout",
    "/payment",
    "/phonepe",
    "/register",
    "/reset-password",
    "/support-agent",
    "/suspended",
    "/verify-email",
    "/verify-phone",
    "/version",
    "/zwsloginsam",
  ].some((prefix) => route === prefix || route.startsWith(`${prefix}/`))
}

function main() {
  const files = walk("app").filter((file) => /\/(page|route)\.(tsx?|jsx?)$/.test(file))
  const routes = files.map((file) => ({ file, route: appRouteFromFile(file), pattern: routePattern(appRouteFromFile(file)), kind: kindOf(appRouteFromFile(file)) }))
  const routeSet = new Set(routes.map((route) => route.route))
  const routePatterns = new Set(routes.map((route) => route.pattern))
  const footerLinks = footerSections.flatMap((section) => section.links.map((link) => ({ section: section.title, ...link })))
  const headerLinks = primaryNav
  const requiredPublic = publicSitemapRoutes.map(normalize)

  const missingFooterRoutes = footerLinks
    .map((link) => normalize(link.href))
    .filter((href) => !href.startsWith("/client-area") && !routeSet.has(href) && !routePatterns.has(routePattern(href)))
  const sitemapMissingRoutes = requiredPublic.filter((href) => !routeSet.has(href) && !routePatterns.has(routePattern(href)))
  const publicUnlinked = routes
    .filter((route) => route.kind === "public")
    .filter((route) => !route.route.includes("["))
    .filter((route) => !isUtilityPublicRoute(route.route))
    .map((route) => route.route)
    .filter((route) => !footerLinks.some((link) => normalize(link.href) === route) && !headerLinks.some((link) => normalize(link.href) === route) && !requiredPublic.includes(route))
    .sort()

  const sourceFiles = walk("app").concat(walk("components"), walk("lib")).filter((file) => /\.(tsx?|jsx?)$/.test(file))
  const source = sourceFiles.map((file) => readFileSync(file, "utf8")).join("\n")
  const orphanPages = routes
    .filter((route) => route.kind !== "api")
    .filter((route) => !route.route.includes("["))
    .filter((route) => route.kind !== "public" || !isUtilityPublicRoute(route.route))
    .filter((route) => route.route !== "/" && !source.includes(`"${route.route}"`) && !source.includes(`'${route.route}'`) && !source.includes(`\`${route.route}`))
    .map((route) => route.route)
    .sort()

  const report = {
    generatedAt: new Date().toISOString(),
    totals: {
      routes: routes.length,
      public: routes.filter((route) => route.kind === "public").length,
      admin: routes.filter((route) => route.kind === "admin").length,
      client: routes.filter((route) => route.kind === "client").length,
      api: routes.filter((route) => route.kind === "api").length,
      dynamicPatterns: routes.filter((route) => route.route.includes("[")).length,
    },
    footer: {
      sections: footerSections.map((section) => ({ title: section.title, links: section.links.length })),
      missingRoutes: Array.from(new Set(missingFooterRoutes)).sort(),
    },
    header: {
      links: headerLinks.map((link) => link.href),
    },
    sitemap: {
      requiredPublicRoutes: requiredPublic.length,
      missingRoutes: Array.from(new Set(sitemapMissingRoutes)).sort(),
    },
    reachability: {
      publicUnlinked,
      orphanPages,
      withinThreeClicksAssumption: "Header, footer, sitemap, and dashboard sidebars are treated as first-click navigation hubs.",
    },
    dynamicSamples: routes.filter((route) => route.route.includes("[")).slice(0, 40),
    routes: routes.sort((a, b) => a.route.localeCompare(b.route)),
  }

  console.log(JSON.stringify(report, null, 2))
  if (report.footer.missingRoutes.length || report.sitemap.missingRoutes.length) {
    process.exitCode = 1
  }
}

main()
