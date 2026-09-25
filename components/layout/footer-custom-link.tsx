"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { parseJsonResponse } from "@/lib/client/safe-json"

export function FooterCustomConfigurationLink() {
  const [enabled, setEnabled] = useState(false)

  useEffect(() => {
    let active = true
    async function loadState() {
      try {
        const res = await fetch("/api/runtime/platform-state", { cache: "no-store" })
        const data = await parseJsonResponse<{ customConfigurationEnabled?: boolean }>(res)
        if (active) setEnabled(Boolean(data.customConfigurationEnabled))
      } catch {
        if (active) setEnabled(false)
      }
    }
    void loadState()
    return () => {
      active = false
    }
  }, [])

  if (!enabled) return null

  return (
    <li>
      <Link href="/configure" className="text-sm text-muted-foreground transition-colors hover:text-foreground">
        Build Custom Instance
      </Link>
    </li>
  )
}
