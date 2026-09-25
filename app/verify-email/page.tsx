import type { Metadata } from "next"
import Link from "next/link"
import { CheckCircle2, AlertCircle } from "lucide-react"
import { SiteShell } from "@/components/layout/site-shell"
import { Container } from "@/components/layout/container"
import { Button } from "@/components/ui/button"
import { EmailVerificationActions } from "@/components/auth/email-verification-actions"
import { emailVerificationRedirect, verifyEmailToken } from "@/lib/email-verification"
import { getBrandName } from "@/lib/settings/site-settings"

export const dynamic = "force-dynamic"
export const metadata: Metadata = {
  robots: "noindex, nofollow",
}

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const { token } = await searchParams
  const result = token ? await verifyEmailToken(token) : { ok: false as const, code: "missing", message: "Verification token is missing." }
  const brandName = await getBrandName()
  const redirectTo = result.ok ? emailVerificationRedirect(result.redirectTo) : emailVerificationRedirect((result as any).redirectTo)
  const email = "customer" in result && result.customer?.email ? result.customer.email : null

  return (
    <SiteShell>
      {result.ok ? <meta httpEquiv="refresh" content={`3;url=${redirectTo}`} /> : null}
      <section className="py-20">
        <Container className="max-w-xl text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-border bg-card">
            {result.ok ? <CheckCircle2 className="h-7 w-7 text-accent" /> : <AlertCircle className="h-7 w-7 text-destructive" />}
          </div>
          <h1 className="mt-6 text-3xl font-semibold tracking-tight">
            {result.ok ? "Email verified" : "Verification link expired"}
          </h1>
          <p className="mt-3 text-muted-foreground">
            {result.ok
              ? `Your ${brandName} email is verified. Redirecting you now.`
              : result.message || "This verification link is invalid or expired. Request a new link to continue."}
          </p>
          {result.ok ? (
            <Button asChild className="mt-6">
              <Link href={redirectTo}>Continue</Link>
            </Button>
          ) : (
            <EmailVerificationActions email={email} redirectTo={redirectTo} />
          )}
        </Container>
      </section>
    </SiteShell>
  )
}
