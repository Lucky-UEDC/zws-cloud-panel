import { Metadata } from "next"
import { WhatsAppAutoRepliesPage } from "@/components/admin/whatsapp-crm-pages"

export const metadata: Metadata = {
  title: "WhatsApp Auto Replies | Admin Dashboard",
  robots: "noindex, nofollow",
}

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export default function AdminWhatsAppAutoRepliesPage() {
  return <WhatsAppAutoRepliesPage />
}
