import Link from "next/link"
import { redirect } from "next/navigation"
import { getSessionFromCookies } from "@/lib/server-auth"
import { prisma } from "@/lib/db"
import { getFlatSetting } from "@/lib/settings"
import { getPublicSiteSettings } from "@/lib/settings/site-settings"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export default async function SuspendedPage() {
  const session = await getSessionFromCookies()
  if (!session || session.role !== "client") {
    redirect("/login")
  }

  const [customer, site, supportUrl, supportEmailOverride, domainOverride] = await Promise.all([
    prisma.customer.findUnique({
      where: { id: session.id },
      select: {
        email: true,
        status: true,
        suspendedReason: true,
        suspendMessage: true,
        suspendUntil: true,
      },
    }),
    getPublicSiteSettings(),
    getFlatSetting("support_url"),
    getFlatSetting("email_support"),
    getFlatSetting("site_domain"),
  ])

  if (!customer) {
    redirect("/login")
  }

  if (customer.status !== "SUSPENDED") {
    redirect("/client-area")
  }

  const supportEmail = supportEmailOverride || site.supportEmail
  const siteDomain = domainOverride || new URL(site.siteUrl).hostname

  return (
    <div className="container mx-auto flex min-h-[70vh] max-w-3xl items-center px-4 py-16">
      <Card className="w-full glass border-border/40">
        <CardHeader>
          <CardTitle className="text-2xl">Your account has been suspended</CardTitle>
          <CardDescription>
            Access is temporarily restricted for <strong>{customer.email}</strong>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <p>{customer.suspendMessage || "Please contact support if you believe this action was applied in error."}</p>
          {customer.suspendedReason ? (
            <p>
              <span className="font-medium text-foreground">Reason:</span> {customer.suspendedReason}
            </p>
          ) : null}
          {customer.suspendUntil ? (
            <p>
              <span className="font-medium text-foreground">Suspended until:</span>{" "}
              {new Date(customer.suspendUntil).toLocaleString()}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-3 pt-2">
            <Button asChild>
              <a href={`mailto:${supportEmail}`}>Contact Support</a>
            </Button>
            {supportUrl ? (
              <Button asChild variant="outline">
                <Link href={supportUrl}>Submit a Ticket</Link>
              </Button>
            ) : null}
            <form action="/api/user/logout" method="post">
              <Button type="submit" variant="ghost">Logout</Button>
            </form>
          </div>

          <p className="pt-2 text-xs">{siteDomain} • Logged in as {customer.email}</p>
        </CardContent>
      </Card>
    </div>
  )
}
