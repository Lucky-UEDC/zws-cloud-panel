"use client"

import { useEffect } from "react"
import { installAuthRefreshListener, installLogoutListener, installSessionHeartbeat } from "@/lib/client/auth-session"

export function ClientAuthProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const uninstallLogout = installLogoutListener("/login")
    const uninstallRefresh = installAuthRefreshListener()
    const uninstallHeartbeat = installSessionHeartbeat()
    return () => {
      uninstallHeartbeat()
      uninstallRefresh()
      uninstallLogout()
    }
  }, [])
  return <>{children}</>
}
