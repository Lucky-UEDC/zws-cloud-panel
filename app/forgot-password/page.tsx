import { AuthShell } from '@/components/auth/auth-shell'
import { ForgotPasswordForm } from '@/components/auth/forgot-password-form'
import { buildPageMetadata } from '@/lib/seo/metadata'

export const dynamic = "force-dynamic"
export const revalidate = 0

export async function generateMetadata() {
  return buildPageMetadata({
    title: 'Forgot Password',
    description: 'Reset your account password.',
    path: '/forgot-password',
    robots: 'noindex, nofollow',
  })
}

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      title="Forgot your password?"
      subtitle="Enter your email and we'll send you a reset link"
      footerText="Know your password?"
      footerLink={{ href: '/login', label: 'Sign in' }}
    >
      <ForgotPasswordForm />
    </AuthShell>
  )
}
