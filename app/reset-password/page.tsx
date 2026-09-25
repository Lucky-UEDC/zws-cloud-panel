import { AuthShell } from '@/components/auth/auth-shell'
import { ResetPasswordForm } from '@/components/auth/reset-password-form'
import { buildPageMetadata } from '@/lib/seo/metadata'

export const dynamic = "force-dynamic"
export const revalidate = 0

export async function generateMetadata() {
  return buildPageMetadata({
    title: 'Reset Password',
    description: 'Create a new password for your account.',
    path: '/reset-password',
    robots: 'noindex, nofollow',
  })
}

export default function ResetPasswordPage() {
  return (
    <AuthShell
      title="Reset your password"
      subtitle="Enter a new password for your account"
      footerText="Remember your password?"
      footerLink={{ href: '/login', label: 'Sign in' }}
    >
      <ResetPasswordForm />
    </AuthShell>
  )
}
