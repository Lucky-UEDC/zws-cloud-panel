import type { Metadata } from "next"
import { WhatsAppGatewayNav } from "@/components/admin/whatsapp-gateway-nav"
import { WhatsAppGatewayOverview } from "@/components/admin/whatsapp-gateway-overview"

export const metadata: Metadata = {
  title: "WhatsApp Gateway | Admin Dashboard",
  robots: "noindex, nofollow",
}

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export default function AdminWhatsAppGatewayOverviewPage() {
  return (
    <div className="space-y-6">
      <WhatsAppGatewayNav />
      <WhatsAppGatewayOverview />
    </div>
  )
}