"use client"

import { Copy } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export function CopyableIp({
  ipAddress,
  className,
  fallbackText = "Assigning IP...",
}: {
  ipAddress?: string | null
  className?: string
  fallbackText?: string
}) {
  if (!ipAddress) {
    return <span className={cn("text-muted-foreground", className)}>{fallbackText}</span>
  }
  const ip = ipAddress

  async function copyIp() {
    try {
      await navigator.clipboard.writeText(ip)
      toast.success("IP copied")
    } catch {
      toast.error("Failed to copy IP")
    }
  }

  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <span>{ipAddress}</span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-6 w-6 text-muted-foreground hover:text-foreground"
        onClick={copyIp}
        aria-label="Copy IP address"
      >
        <Copy className="h-3.5 w-3.5" />
      </Button>
    </span>
  )
}
