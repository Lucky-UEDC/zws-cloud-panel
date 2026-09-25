"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Inbox, LifeBuoy } from "lucide-react"
import { cn } from "@/lib/utils"

const navItems = [
  { label: "Support Queue", href: "/support-agent", icon: Inbox },
  { label: "Tickets", href: "/support-agent", icon: LifeBuoy },
]

export function SupportAgentSidebar() {
  const pathname = usePathname()

  return (
    <aside className="hidden lg:flex w-64 flex-col border-r border-border/40 bg-background/50 min-h-[calc(100vh-64px)]">
      <nav className="flex flex-col gap-1 p-4">
        {navItems.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href)
          return (
            <Link
              key={`${item.href}-${item.label}`}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 text-sm font-medium transition-[background,border-color,color]",
                isActive ? "selected-item" : "text-muted-foreground hover:bg-[rgba(255,255,255,0.04)] hover:text-foreground",
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
