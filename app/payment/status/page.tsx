import type { Metadata } from "next"
import { Suspense } from "react"
import { Container } from "@/components/layout/container"
import { SiteShell } from "@/components/layout/site-shell"
import { PaymentStatusContent } from "@/components/payment/payment-status-content"

export const metadata: Metadata = {
  robots: "noindex, nofollow",
}

export default function PaymentStatusPage() {
  return (
    <SiteShell>
      <Container className="py-20">
        <Suspense fallback={<PaymentStatusLoading />}>
          <PaymentStatusFetcher />
        </Suspense>
      </Container>
    </SiteShell>
  )
}

async function PaymentStatusFetcher() {
  return <PaymentStatusContent />
}

function PaymentStatusLoading() {
  return (
    <div className="mx-auto max-w-lg text-center">
      <div className="glass glass-strong rounded-2xl p-8">
        <div className="mx-auto mb-4 h-16 w-16 animate-pulse rounded-full bg-muted/30" />
        <div className="mx-auto mb-2 h-6 w-48 animate-pulse rounded bg-muted/30" />
        <div className="mx-auto h-4 w-64 animate-pulse rounded bg-muted/30" />
      </div>
    </div>
  )
}
