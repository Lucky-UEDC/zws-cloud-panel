import type { Metadata } from "next"
import { WhatsAppGatewayNav } from "@/components/admin/whatsapp-gateway-nav"
import { WhatsAppGatewayContacts } from "@/components/admin/whatsapp-gateway-contacts"

export const metadata: Metadata = {
  title: "WhatsApp Gateway Contacts | Admin Dashboard",
  robots: "noindex, nofollow",
}

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export default function AdminWhatsAppGatewayContactsPage() {
  return (
    <div className="space-y-6">
      <WhatsAppGatewayNav />
      <WhatsAppGatewayContacts />
    </div>
  )
}