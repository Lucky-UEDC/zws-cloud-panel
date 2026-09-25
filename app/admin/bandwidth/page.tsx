import { LiveBandwidthDashboard } from "@/app/admin/bandwidth/live-bandwidth-dashboard"
import { loadAdminBandwidthDashboard } from "@/lib/admin-bandwidth-dashboard"

export const dynamic = "force-dynamic"

export default async function AdminBandwidthPage() {
  const initialData = await loadAdminBandwidthDashboard()
  return <LiveBandwidthDashboard initialData={initialData} />
}
