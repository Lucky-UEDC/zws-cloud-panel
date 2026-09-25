"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { FileText, MessageSquare, Settings, Users } from "lucide-react"
import { cn } from "@/lib/utils"

const items = [
  { label: "Overview", href: "/admin/whatsapp-gateway", icon: MessageSquare },
  { label: "Send Message", href: "/admin/whatsapp-gateway/send", icon: MessageSquare },
  { label: "Templates", href: "/admin/whatsapp-gateway/templates", icon: FileText },
  { label: "Contacts", href: "/admin/whatsapp-gateway/contacts", icon: Users },
  { label: "Message History", href: "/admin/whatsapp-gateway/messages", icon: FileText },
  { label: "Settings", href: "/admin/whatsapp-gateway/settings", icon: Settings },
]

export function WhatsAppGatewayNav() {
  const pathname = usePathname()
  return (
    <div className="hide-scrollbar min-w-0 max-w-full overflow-x-auto overflow-y-hidden scroll-smooth pb-2">
      <div className="flex w-max gap-2">
        {items.map((item) => {
          const Icon = item.icon
          const active = pathname === item.href
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex shrink-0 items-center gap-2 rounded-md border px-3 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/50",
                active ? "border-emerald-400 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "border-border bg-background hover:bg-muted",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {item.label}
            </Link>
          )
        })}
      </div>
    </div>
  )
}