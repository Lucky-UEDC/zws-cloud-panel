import Link from "next/link"
import { Container } from "@/components/layout/container"
import { Logo } from "@/components/brand/logo"

/**
 * Shared layout wrapper for all auth pages.
 * Keeps header/logo/title styling consistent and pushes the form into
 * a centered glass card that sits over the global dot field.
 */
export function AuthShell({
  title,
  description,
  subtitle,
  children,
  footer,
  footerText,
  footerLink,
}: {
  title: string
  description?: string
  subtitle?: string
  children: React.ReactNode
  footer?: React.ReactNode
  footerText?: string
  footerLink?: { href: string; label: string }
}) {
  const resolvedDescription = description ?? subtitle ?? ""
  const resolvedFooter =
    footer ??
    (footerText && footerLink ? (
      <>
        {footerText}{" "}
        <Link href={footerLink.href} className="text-foreground underline underline-offset-4">
          {footerLink.label}
        </Link>
      </>
    ) : null)

  return (
    <Container className="interactive-layer py-16 sm:py-24">
      <div className="interactive-layer mx-auto flex w-full max-w-[520px] flex-col gap-8">
        {/* Ambient accent glow behind the card. */}
        <div className="decorative-layer absolute -inset-10 -z-10 rounded-[40px] bg-[radial-gradient(60%_60%_at_50%_0%,color-mix(in_oklch,var(--accent)_18%,transparent),transparent_70%)] blur-2xl" data-decorative-layer />

        <div className="flex flex-col items-center gap-3 text-center">
          <Logo withText={false} className="glass inline-flex items-center justify-center rounded-xl p-2" />
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="text-sm text-muted-foreground text-pretty">
            {resolvedDescription}
          </p>
        </div>

        <div className="glass glass-strong accent-glow interactive-layer rounded-2xl border border-[var(--border-primary)] bg-[var(--surface-primary)]/80 p-5 shadow-[0_24px_80px_rgba(0,0,0,0.45)] backdrop-blur-2xl sm:p-8">
          {children}
        </div>

        {resolvedFooter && (
          <p className="text-center text-xs text-muted-foreground text-balance">
            {resolvedFooter}
          </p>
        )}
      </div>
    </Container>
  )
}
