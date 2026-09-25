"use client"

import Link from "next/link"
import { useEffect } from "react"
import { Button } from "@/components/ui/button"

export default function CustomerDetailsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[customer-page] render_error", { message: error.message, digest: error.digest })
  }, [error])

  return (
    <div className="space-y-4 rounded-md border border-border/40 bg-background/60 p-5">
      <div>
        <h1 className="text-xl font-semibold">Customer profile temporarily unavailable</h1>
        <p className="mt-1 text-sm text-muted-foreground">The profile view recovered from a render error. Retry or return to the customer list.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={reset}>Retry</Button>
        <Button asChild type="button" variant="outline">
          <Link href="/admin/customers">Customers</Link>
        </Button>
      </div>
    </div>
  )
}
