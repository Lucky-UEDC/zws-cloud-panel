"use client"

import { useEffect } from "react"
import Link from "next/link"
import { Home, RefreshCw, LifeBuoy } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Container } from "@/components/layout/container"

export default function CheckoutError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("[checkout_route_error]", {
      name: error.name,
      message: error.message,
      digest: error.digest || null,
      stack: error.stack || null,
    })
  }, [error])

  return (
    <main className="flex min-h-[80vh] items-center">
      <Container>
        <div className="mx-auto max-w-xl text-center">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-destructive">Checkout unavailable</p>
          <h1 className="mt-4 text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
            We could not prepare checkout.
          </h1>
          <p className="mt-5 text-pretty text-muted-foreground">
            Your payment has not started. Retry checkout, choose another plan, or contact support if this keeps happening.
          </p>
          {error.digest ? <p className="mt-3 font-mono text-xs text-muted-foreground">Ref: {error.digest}</p> : null}
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button onClick={reset} size="lg" className="gap-1.5">
              <RefreshCw className="h-4 w-4" />
              Retry checkout
            </Button>
            <Button asChild size="lg" variant="outline" className="gap-1.5">
              <Link href="/pricing">
                <Home className="h-4 w-4" />
                View plans
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="gap-1.5">
              <Link href="/support">
                <LifeBuoy className="h-4 w-4" />
                Support
              </Link>
            </Button>
          </div>
        </div>
      </Container>
    </main>
  )
}
