import { Metadata } from "next"
import { WhatsAppContactsPage } from "@/components/admin/whatsapp-crm-pages"

export const metadata: Metadata = {
  title: "WhatsApp Contacts | Admin Dashboard",
  robots: "noindex, nofollow",
}

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export default function AdminWhatsAppContactsPage() {
  return <WhatsAppContactsPage />
}
