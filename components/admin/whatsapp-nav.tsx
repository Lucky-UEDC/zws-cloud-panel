"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Bot, FileText, MessageCircle, MessageSquare, Radio, Settings, Users, Webhook } from "lucide-react"
import { cn } from "@/lib/utils"

const items = [
  { label: "Overview", href: "/admin/whatsapp", icon: MessageCircle },
  { label: "Templates", href: "/admin/whatsapp/templates", icon: FileText },
  { label: "Contacts", href: "/admin/whatsapp/contacts", icon: Users },
  { label: "Conversations", href: "/admin/whatsapp/conversations", icon: MessageSquare },
  { label: "Campaigns", href: "/admin/whatsapp/campaigns", icon: Radio },
  { label: "Auto Replies", href: "/admin/whatsapp/auto-replies", icon: Bot },
  { label: "Message Logs", href: "/admin/whatsapp/logs", icon: FileText },
  { label: "Webhook Logs", href: "/admin/whatsapp/webhook-logs", icon: Webhook },
  { label: "Settings", href: "/admin/whatsapp/settings", icon: Settings },
]

export function WhatsAppNav() {
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
                active ? "border-emerald-400 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "border-border bg-background hover:bg-muted"
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
