import type { Metadata } from "next"
import { WhatsAppGatewayNav } from "@/components/admin/whatsapp-gateway-nav"
import { WhatsAppGatewaySettings } from "@/components/admin/whatsapp-gateway-settings"

export const metadata: Metadata = {
  title: "WhatsApp Gateway Settings | Admin Dashboard",
  robots: "noindex, nofollow",
}

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export default function AdminWhatsAppGatewaySettingsPage() {
  return (
    <div className="space-y-6">
      <WhatsAppGatewayNav />
      <WhatsAppGatewaySettings />
    </div>
  )
}