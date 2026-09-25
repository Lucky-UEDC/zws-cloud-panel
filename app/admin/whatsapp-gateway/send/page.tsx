import type { Metadata } from "next"
import { WhatsAppGatewayNav } from "@/components/admin/whatsapp-gateway-nav"
import { WhatsAppGatewaySend } from "@/components/admin/whatsapp-gateway-send"

export const metadata: Metadata = {
  title: "WhatsApp Gateway Send | Admin Dashboard",
  robots: "noindex, nofollow",
}

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export default function AdminWhatsAppGatewaySendPage() {
  return (
    <div className="space-y-6">
      <WhatsAppGatewayNav />
      <WhatsAppGatewaySend />
    </div>
  )
}