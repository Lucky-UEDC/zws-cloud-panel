import { Metadata } from "next"
import { WhatsAppWebhookLogsPage } from "@/components/admin/whatsapp-crm-pages"

export const metadata: Metadata = {
  title: "WhatsApp Webhook Logs | Admin Dashboard",
  robots: "noindex, nofollow",
}

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export default function AdminWhatsAppWebhookLogsPage() {
  return <WhatsAppWebhookLogsPage />
}
