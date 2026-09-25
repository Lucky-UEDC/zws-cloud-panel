import type { Metadata } from "next"
import { WhatsAppGatewayNav } from "@/components/admin/whatsapp-gateway-nav"
import { WhatsAppGatewayTemplates } from "@/components/admin/whatsapp-gateway-templates"

export const metadata: Metadata = {
  title: "WhatsApp Gateway Templates | Admin Dashboard",
  robots: "noindex, nofollow",
}

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export default function AdminWhatsAppGatewayTemplatesPage() {
  return (
    <div className="space-y-6">
      <WhatsAppGatewayNav />
      <WhatsAppGatewayTemplates />
    </div>
  )
}