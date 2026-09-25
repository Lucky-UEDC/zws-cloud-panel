import type { Metadata } from "next"
import { WhatsAppGatewayNav } from "@/components/admin/whatsapp-gateway-nav"
import { WhatsAppGatewayMessages } from "@/components/admin/whatsapp-gateway-messages"

export const metadata: Metadata = {
  title: "WhatsApp Gateway Messages | Admin Dashboard",
  robots: "noindex, nofollow",
}

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export default function AdminWhatsAppGatewayMessagesPage() {
  return (
    <div className="space-y-6">
      <WhatsAppGatewayNav />
      <WhatsAppGatewayMessages />
    </div>
  )
}