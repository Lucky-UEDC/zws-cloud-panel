import { WhatsAppReportPage } from "@/components/admin/whatsapp-report-page"

export default function WhatsAppAnalyticsPage() {
  return <WhatsAppReportPage title="WhatsApp Analytics" description="Campaign, media, delivery, read, click, conversion, join, and unsubscribe telemetry." endpoint="/api/admin/whatsapp/metrics" />
}
