import { Metadata } from "next"
import { WhatsAppManager } from "@/components/admin/whatsapp-manager"
import { WhatsAppNav } from "@/components/admin/whatsapp-nav"
import { WhatsAppChannelPromotion } from "@/components/admin/whatsapp-channel-promotion"

export const metadata: Metadata = {
  title: "WhatsApp Settings | Admin Dashboard",
  robots: "noindex, nofollow",
}

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export default function AdminWhatsAppSettingsPage() {
  return (
    <div className="space-y-6">
      <WhatsAppNav />
      <WhatsAppManager />
      <WhatsAppChannelPromotion />
    </div>
  )
}
