"use client"

import { useEffect } from "react"
import Link from "next/link"
import { RefreshCw, Home } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Container } from "@/components/layout/container"
import { logFrontendError } from "@/lib/client/frontend-error-logger"

function isChunkLoadError(error: Error) {
  return error.name === "ChunkLoadError" || /loading chunk|failed to fetch dynamically imported module|module script/i.test(error.message || "")
}

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("[route_error]", {
      name: error.name,
      message: error.message,
      digest: error.digest || null,
      stack: error.stack || null,
    })
    logFrontendError({
      source: "app/error",
      name: error.name,
      message: error.message,
      digest: error.digest || null,
      stack: error.stack || null,
    })

    if (typeof window !== "undefined" && isChunkLoadError(error)) {
      const key = `chunk-recovery:${window.location.pathname}`
      if (sessionStorage.getItem(key) !== "1") {
        sessionStorage.setItem(key, "1")
        window.location.reload()
      }
    }
  }, [error])

  return (
    <main className="flex min-h-[80vh] items-center">
      <Container>
        <div className="mx-auto max-w-xl text-center">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-destructive">
            Unexpected error
          </p>
          <h1 className="mt-4 text-balance text-5xl font-semibold tracking-tight sm:text-6xl">
            Runtime error
          </h1>
          <p className="mt-5 text-pretty text-muted-foreground">
            Something went wrong while rendering this page. Please try again.
          </p>
          {error.digest && (
            <p className="mt-3 font-mono text-xs text-muted-foreground">
              Ref: {error.digest}
            </p>
          )}
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button onClick={reset} size="lg" className="gap-1.5">
              <RefreshCw className="h-4 w-4" />
              Try again
            </Button>
            <Button asChild size="lg" variant="outline" className="gap-1.5">
              <Link href="/">
                <Home className="h-4 w-4" />
                Back to home
              </Link>
            </Button>
          </div>
        </div>
      </Container>
    </main>
  )
}
