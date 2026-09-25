"use client"

import { useEffect } from "react"
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
    console.error("[global_error]", {
      name: error.name,
      message: error.message,
      digest: error.digest || null,
      stack: error.stack || null,
    })
    logFrontendError({
      source: "app/global-error",
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
    <html lang="en" className="dark bg-background">
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        <main className="flex min-h-screen items-center justify-center px-6">
          <div className="max-w-lg text-center">
            <p className="font-mono text-xs uppercase text-destructive">Application recovery</p>
            <h1 className="mt-4 text-4xl font-semibold tracking-tight">The application needs a refresh.</h1>
            <p className="mt-4 text-sm text-muted-foreground">
              A runtime problem was caught before this page could render normally.
            </p>
            {error.digest ? <p className="mt-3 font-mono text-xs text-muted-foreground">Ref: {error.digest}</p> : null}
            <button
              type="button"
              onClick={reset}
              className="mt-6 inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
            >
              Try again
            </button>
          </div>
        </main>
      </body>
    </html>
  )
}
