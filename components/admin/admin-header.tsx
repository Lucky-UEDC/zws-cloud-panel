"use client"

import Link from "next/link"
import { LogOut, Menu, Shield, User } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useState } from "react"
import { logoutEverywhere } from "@/lib/client/auth-session"
import { AdminQuickSearch } from "@/components/admin/admin-quick-search"

type AdminUser = {
  email: string
  displayName: string
  role: string
}

export function AdminHeader({
  user,
  brandName = "Admin",
  homeHref = "/admin",
}: {
  user: AdminUser
  brandName?: string
  homeHref?: string
}) {
  const [isLoggingOut, setIsLoggingOut] = useState(false)

  function handleLogout() {
    setIsLoggingOut(true)
    void logoutEverywhere("/api/admin/auth/logout", "/login")
  }

  function openMobileSidebar() {
    window.dispatchEvent(new Event("zws-admin-sidebar:open"))
  }

  return (
    <header className="sticky top-0 z-50 max-w-full border-b border-border/40 bg-background/80 backdrop-blur-xl">
      <div className="flex h-16 min-w-0 items-center justify-between gap-2 px-3 sm:px-4 lg:px-8">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3 lg:gap-4">
          <Button type="button" variant="ghost" size="icon" className="lg:hidden" onClick={openMobileSidebar} aria-label="Open admin navigation">
            <Menu className="h-5 w-5" />
          </Button>
          <Link href={homeHref} className="flex min-w-0 items-center gap-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--border-selected)] bg-[var(--accent-subtle)] text-[var(--text-selected)]">
              <Shield className="h-4 w-4" />
            </div>
            <span className="max-w-[42vw] truncate font-semibold sm:max-w-none">{brandName}</span>
          </Link>
        </div>

        <div className="flex min-w-0 items-center gap-1.5 sm:gap-2 lg:gap-4">
          <div className="hidden min-w-0 md:block">
            <AdminQuickSearch />
          </div>
          <Link 
            href="/" 
            className="hidden text-sm text-muted-foreground transition-colors hover:text-foreground lg:inline"
          >
            View Site
          </Link>
          
          <div className="flex min-w-0 items-center gap-2 rounded-lg bg-muted/30 px-2 py-1.5 sm:gap-3 sm:px-3">
            <div className="flex h-7 w-7 items-center justify-center rounded-full border border-[var(--border-selected)] bg-[var(--accent-subtle)] text-[var(--text-selected)]">
              <User className="h-4 w-4" />
            </div>
            <div className="hidden sm:block">
              <p className="max-w-36 truncate text-sm font-medium xl:max-w-48">{user.displayName}</p>
              <p className="max-w-36 truncate text-xs text-muted-foreground xl:max-w-48">{user.email}</p>
            </div>
          </div>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={handleLogout}
            disabled={isLoggingOut}
            className="text-muted-foreground hover:text-destructive"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </header>
  )
}
