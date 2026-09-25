"use client"

import Link from "next/link"
import { LogOut, Menu, User } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useState } from "react"
import { logoutEverywhere } from "@/lib/client/auth-session"

type ClientUser = {
  email: string
  name: string
}

export function ClientHeader({
  user,
  brandName = "Client Area",
}: {
  user: ClientUser
  brandName?: string
}) {
  const [isLoggingOut, setIsLoggingOut] = useState(false)

  function handleLogout() {
    setIsLoggingOut(true)
    void logoutEverywhere("/api/auth/logout", "/login")
  }

  function openMobileNavigation() {
    window.dispatchEvent(new Event("zws-client-sidebar:open"))
  }

  return (
    <header className="sticky top-0 z-50 max-w-full border-b border-border/40 bg-background/80 backdrop-blur-xl">
      <div className="flex h-16 min-w-0 items-center justify-between gap-2 px-3 sm:px-4 lg:px-8">
        <div className="flex min-w-0 items-center gap-2 sm:gap-4">
          <Button type="button" variant="ghost" size="icon" className="lg:hidden" onClick={openMobileNavigation} aria-label="Open navigation">
            <Menu className="h-5 w-5" />
          </Button>
          <Link href="/client-area" className="flex min-w-0 items-center gap-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--border-selected)] bg-[var(--accent-subtle)] text-[var(--text-selected)]">
              <User className="h-4 w-4" />
            </div>
            <span className="truncate font-semibold">{brandName}</span>
          </Link>
        </div>

        <div className="flex min-w-0 items-center gap-1.5 sm:gap-3 lg:gap-4">
          <Link href="/" className="hidden text-sm text-muted-foreground transition-colors hover:text-foreground sm:inline">
            View Site
          </Link>
          <div className="flex min-w-0 items-center gap-3 rounded-lg bg-muted/30 px-2 py-1.5 sm:px-3">
            <div className="hidden sm:block">
              <p className="max-w-28 truncate text-sm font-medium md:max-w-40">{user.name}</p>
              <p className="max-w-28 truncate text-xs text-muted-foreground md:max-w-40">{user.email}</p>
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
