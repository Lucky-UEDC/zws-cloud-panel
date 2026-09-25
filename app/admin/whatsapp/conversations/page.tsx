import { Metadata } from "next"
import { WhatsAppConversationsPage } from "@/components/admin/whatsapp-crm-pages"

export const metadata: Metadata = {
  title: "WhatsApp Conversations | Admin Dashboard",
  robots: "noindex, nofollow",
}

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export default function AdminWhatsAppConversationsPage() {
  return <WhatsAppConversationsPage />
}
