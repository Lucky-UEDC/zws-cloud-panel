import { SmartConsole } from "@/components/console/smart-console"

export const dynamic = "force-dynamic"
export const revalidate = 0

export default async function AdminVmConsolePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <SmartConsole
      title="Admin VM console"
      sessionEndpoint={`/api/admin/vms/${encodeURIComponent(id)}/console/session`}
      overviewEndpoint={`/api/admin/vms/${encodeURIComponent(id)}/console/overview`}
      resizeEndpoint={`/api/admin/vms/${encodeURIComponent(id)}/console/resize`}
      ctrlAltDelEndpoint={`/api/admin/vms/${encodeURIComponent(id)}/console/ctrl-alt-del`}
      powerEndpoint={`/api/admin/vms/${encodeURIComponent(id)}/actions`}
    />
  )
}
