"use client"

import { Chrome } from "lucide-react"
import { Button } from "@/components/ui/button"

export function GoogleOAuthButton({ role = "client", nextTo = "" }: { role?: "client" | "admin"; nextTo?: string }) {
  if (!["1", "true", "yes", "on", "enabled"].includes(String(process.env.NEXT_PUBLIC_GOOGLE_OAUTH_LOGIN_ENABLED || "").toLowerCase())) return null
  function startGoogle() {
    const params = new URLSearchParams({ role })
    if (nextTo && nextTo.startsWith("/") && !nextTo.startsWith("//")) params.set("next", nextTo)
    window.location.assign(`/api/auth/google/start?${params.toString()}`)
  }

  return (
    <Button type="button" variant="outline" className="w-full gap-2" onClick={startGoogle}>
      <Chrome className="h-4 w-4" />
      Continue with Google
    </Button>
  )
}
