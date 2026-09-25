"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { Menu, X, ArrowRight, LayoutDashboard, LogOut, UserCircle2 } from "lucide-react"
import { Logo } from "@/components/brand/logo"
import { Button } from "@/components/ui/button"
import { Container } from "@/components/layout/container"
import { cn } from "@/lib/utils"
import { getDashboardHref } from "@/lib/roles"
import { parseJsonResponse } from "@/lib/client/safe-json"
import { logoutEverywhere } from "@/lib/client/auth-session"
import { primaryNav } from "@/lib/navigation"

type SessionUser =
  | { role: "admin" | "support_agent"; email: string; displayName: string }
  | { role: "client"; id: string; email: string; name: string }
  | null

const staticNav = primaryNav.map((item) => ({ ...item, customConfiguration: item.href === "/configure" }))

export function Navbar({ brandName = "Cloud" }: { brandName?: string }) {
  const [open, setOpen] = useState(false)
  const [session, setSession] = useState<SessionUser>(null)
  const [loaded, setLoaded] = useState(false)
  const [customConfigurationEnabled, setCustomConfigurationEnabled] = useState(false)

  useEffect(() => {
    let active = true

    async function loadSession() {
      try {
        const res = await fetch("/api/auth/session?optional=1", { credentials: "include", cache: "no-store" })
        if (!active) return

        if (!res.ok) {
          if (res.status === 401) {
            setSession(null)
            setLoaded(true)
          }
          return
        }

        const data = await parseJsonResponse(res)
        if (data?.authenticated && data?.user?.role) {
          setSession(data.user)
          setLoaded(true)
        } else {
          setSession(null)
          setLoaded(true)
        }
      } catch {
        return
      }
    }

    loadSession()
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true
    async function loadPlatformState() {
      try {
        const res = await fetch("/api/runtime/platform-state", { cache: "no-store" })
        const data = await parseJsonResponse<{ customConfigurationEnabled?: boolean }>(res)
        if (active) setCustomConfigurationEnabled(Boolean(data.customConfigurationEnabled))
      } catch {
        if (active) setCustomConfigurationEnabled(false)
      }
    }
    void loadPlatformState()
    return () => {
      active = false
    }
  }, [])

  const dashboardHref = session ? getDashboardHref(session.role) : "/client-area"
  const navItems = staticNav.filter((item) => !item.customConfiguration || customConfigurationEnabled)

  async function handleLogout() {
    await logoutEverywhere("/api/auth/logout", "/login")
  }

  return (
    <header className="sticky top-0 z-50 w-full bg-background/70 backdrop-blur-md supports-[backdrop-filter]:bg-background/50">
      <Container className="flex h-16 items-center justify-between gap-4">
        <div className="flex items-center gap-8">
          <Logo initialBrandName={brandName} />
          <nav aria-label="Primary" className="hidden items-center gap-1 lg:flex">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="hidden min-h-8 items-center gap-2 lg:flex">
          {loaded ? (
            session ? (
              <>
                <Button variant="ghost" size="sm" asChild>
                  <Link href={dashboardHref} className="gap-1.5">
                    <LayoutDashboard className="h-3.5 w-3.5" />
                    Dashboard
                  </Link>
                </Button>
                <Button variant="ghost" size="sm" asChild>
                  <Link href={dashboardHref} className="gap-1.5">
                    <UserCircle2 className="h-3.5 w-3.5" />
                    Account
                  </Link>
                </Button>
                <Button variant="outline" size="sm" className="gap-1.5" onClick={handleLogout}>
                    <LogOut className="h-3.5 w-3.5" />
                    Logout
                </Button>
              </>
            ) : (
              <>
                <Button variant="ghost" size="sm" asChild>
                  <Link href="/login">Log in</Link>
                </Button>
                <Button size="sm" asChild className="gap-1.5">
                  <Link href="/register">
                    Get started
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </Button>
              </>
            )
          ) : null}
        </div>

        <button
          type="button"
          className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border text-foreground lg:hidden"
          aria-label="Toggle menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
        </button>
      </Container>

      {open && (
        <div className="glass lg:hidden">
          <Container className="flex flex-col gap-1 py-4">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className="rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {item.label}
              </Link>
            ))}
            <div className="mt-3 flex flex-col gap-2 pt-4">
              {loaded ? (
                session ? (
                  <>
                    <Button variant="outline" asChild>
                      <Link href={dashboardHref} onClick={() => setOpen(false)}>
                        Dashboard
                      </Link>
                    </Button>
                    <Button
                      onClick={() => {
                        setOpen(false)
                        void handleLogout()
                      }}
                    >
                        Logout
                    </Button>
                  </>
                ) : (
                  <>
                    <Button variant="outline" asChild>
                      <Link href="/login" onClick={() => setOpen(false)}>
                        Log in
                      </Link>
                    </Button>
                    <Button asChild>
                      <Link href="/register" onClick={() => setOpen(false)}>
                        Get started
                      </Link>
                    </Button>
                  </>
                )
              ) : null}
            </div>
          </Container>
        </div>
      )}
    </header>
  )
}
