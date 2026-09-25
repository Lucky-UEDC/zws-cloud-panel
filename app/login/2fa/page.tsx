import { redirect } from 'next/navigation'
import { AuthShell } from '@/components/auth/auth-shell'
import { TwoFactorForm } from '@/components/auth/two-factor-form'
import { getSessionFromCookies } from '@/lib/server-auth'
import { getDashboardHref } from '@/lib/roles'
import { buildPageMetadata } from '@/lib/seo/metadata'

export async function generateMetadata() {
  return buildPageMetadata({
    title: 'Security Verification',
    description: 'Complete sign-in with your authenticator code.',
    path: '/login/2fa',
    robots: 'noindex, nofollow',
  })
}

export default async function LoginTwoFactorPage() {
  const session = await getSessionFromCookies()
  if (session?.role) {
    redirect(getDashboardHref(session.role))
  }

  return (
    <AuthShell
      title="Security Verification"
      subtitle="Verify your identity to continue securely."
      footerText="Need to use a different account?"
      footerLink={{ href: '/login', label: 'Return to login' }}
    >
      <TwoFactorForm />
    </AuthShell>
  )
}
