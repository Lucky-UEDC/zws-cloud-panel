import { AuthShell } from '@/components/auth/auth-shell'
import { LoginForm } from '@/components/auth/login-form'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getSessionFromCookies } from '@/lib/server-auth'
import { getDashboardHref } from '@/lib/roles'
import { buildPageMetadata } from '@/lib/seo/metadata'
import { GoogleOAuthButton } from '@/components/auth/google-oauth-button'
import { isGoogleOAuthLoginEnabled } from '@/lib/auth/google-oauth-toggle'
import { canAccessAdminPath } from '@/lib/admin-rbac'
import { isCheckoutResumePath, safeClientReturnPath } from '@/lib/client/checkout-resume'

export async function generateMetadata() {
  return buildPageMetadata({
    title: 'Sign In',
    description: 'Sign in to your account.',
    path: '/login',
    robots: 'noindex, nofollow',
  })
}

function safeReturnPath(value?: string) {
  return safeClientReturnPath(value)
}

export default async function LoginPage({ searchParams }: { searchParams?: Promise<{ next?: string; returnTo?: string; expired?: string }> }) {
  const params = (await searchParams) || {}
  const next = safeReturnPath(typeof params.returnTo === "string" ? params.returnTo : typeof params.next === "string" ? params.next : "")
  const session = await getSessionFromCookies()
  if (session?.role) {
    if (next.startsWith("/admin") && canAccessAdminPath(session.role, next)) redirect(next)
    if ((next.startsWith("/client-area") || isCheckoutResumePath(next)) && session.role === "client") redirect(next)
    redirect(getDashboardHref(session.role))
  }
  const sessionExpired = params.expired === "1"
  const googleEnabled = await isGoogleOAuthLoginEnabled()

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to your account to continue"
      footerText="Don't have an account?"
      footerLink={{ href: '/register', label: 'Create one' }}
    >
      {googleEnabled ? (
        <>
          <GoogleOAuthButton role={next.startsWith("/admin") ? "admin" : "client"} nextTo={next} />
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border/60" />
            <span>or</span>
            <span className="h-px flex-1 bg-border/60" />
          </div>
        </>
      ) : null}
      <LoginForm nextTo={next} />
      {sessionExpired ? (
        <div role="status" className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
          Session expired. Please login again.
        </div>
      ) : null}
      <div className="text-center text-xs text-muted-foreground">
        <Link href="/forgot-password" className="text-accent hover:underline">
          Forgot your password?
        </Link>
      </div>
    </AuthShell>
  )
}
