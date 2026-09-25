"use client"

import { useEffect } from "react"
import Link from "next/link"
import { AlertTriangle, LogIn, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Admin runtime error", {
      message: error.message,
      digest: error.digest,
      stack: error.stack,
    })
  }, [error])

  return (
    <Card className="glass border-border/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-amber-400" />
          Admin page failed to load
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          The admin runtime hit an error while loading this page. Try again, or sign in again if your session expired.
        </p>
        {error.digest ? <p className="font-mono text-xs text-muted-foreground">Error reference: {error.digest}</p> : null}
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={reset} className="gap-2">
            <RefreshCw className="h-4 w-4" />
            Try again
          </Button>
          <Button asChild type="button" variant="outline" className="gap-2">
            <Link href="/login?returnTo=/admin">
              <LogIn className="h-4 w-4" />
              Sign in again
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
