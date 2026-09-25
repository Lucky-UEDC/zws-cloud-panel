export type ComingSoonRoute = {
  path: string
  pageName: string
  title: string
  description: string
  showExplorePlans?: boolean
}

export const comingSoonRoutes = [
  {
    path: "/cloud",
    pageName: "Cloud Catalog",
    title: "Cloud Catalog",
    description: "A cleaner catalog for cloud products, regions, and deployment paths is being prepared.",
    showExplorePlans: true,
  },
  {
    path: "/compare",
    pageName: "Compare Cloud Plans",
    title: "Compare Cloud Plans",
    description: "A focused comparison workspace for compute plans, dedicated servers, and common cloud alternatives is being prepared.",
    showExplorePlans: true,
  },
] as const satisfies readonly ComingSoonRoute[]

const comingSoonRouteMap = new Map<string, ComingSoonRoute>(
  comingSoonRoutes.map((route) => [route.path, route]),
)

export function getComingSoonRoute(path: string) {
  return comingSoonRouteMap.get(path)
}

export function isComingSoonRoute(path: string) {
  return comingSoonRouteMap.has(path)
}
