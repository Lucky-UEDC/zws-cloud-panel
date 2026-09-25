"use client"

import { useEffect } from "react"
import { usePathname, useRouter } from "next/navigation"
import { adminForbiddenRedirect, canAccessAdminPath } from "@/lib/admin-rbac"

export function AdminRouteGuard({ role }: { role: string }) {
  const pathname = usePathname()
  const router = useRouter()
  useEffect(() => {
    if (!canAccessAdminPath(role, pathname)) {
      router.replace(adminForbiddenRedirect(role))
    }
  }, [pathname, role, router])
  return null
}
