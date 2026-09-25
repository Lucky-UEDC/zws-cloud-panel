"use client"

import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { DotGridBackground } from "@/components/effects/dot-grid-background"
import { MouseGlowLayer } from "@/components/effects/mouse-glow-layer"

type PanelBackgroundScope = "global" | "panel"

export function PanelBackground({
  className,
  scope = "panel",
}: {
  className?: string
  scope?: PanelBackgroundScope
}) {
  const pathname = usePathname()

  const isPanelRoute = pathname?.startsWith("/admin") || pathname?.startsWith("/client-area")
  if (scope === "global" && isPanelRoute) {
    return null
  }

  return (
    <div
      aria-hidden="true"
      className={cn("decorative-layer pointer-events-none fixed inset-0 z-0 overflow-hidden", className)}
      data-panel-background-root
      data-decorative-layer
      data-panel-background-scope={scope}
    >
      <DotGridBackground />
      <MouseGlowLayer />
    </div>
  )
}
