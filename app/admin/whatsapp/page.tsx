import { Metadata } from "next"
import { WhatsAppOverviewPage } from "@/components/admin/whatsapp-crm-pages"

export const metadata: Metadata = {
  title: "WhatsApp | Admin Dashboard",
  robots: "noindex, nofollow",
}

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export default function AdminWhatsAppPage() {
  return <WhatsAppOverviewPage />
}
