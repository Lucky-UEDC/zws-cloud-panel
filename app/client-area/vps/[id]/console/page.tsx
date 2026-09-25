import { SmartConsole } from "@/components/console/smart-console"
import { prisma } from "@/lib/db"
import { getClientFromCookies } from "@/lib/server-auth"

export const dynamic = "force-dynamic"
export const revalidate = 0

export default async function ClientVpsConsolePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const customer = await getClientFromCookies()
  const customerId = String(customer?.sub || "")
  const vps = customerId
    ? await prisma.vpsInstance.findFirst({
        where: { OR: [{ id }, { orderId: id }], customerId, deletedAt: null, status: { not: "DELETED" } },
        select: { name: true },
      }).catch(() => null)
    : null
  const serverName = vps?.name || "Cloud server"
  const encodedId = encodeURIComponent(id)

  return (
    <SmartConsole
      title="Server console"
      sessionEndpoint={`/api/client/vps/${encodedId}/console/session`}
      overviewEndpoint={`/api/client/vps/${encodedId}/console/overview`}
      resizeEndpoint={`/api/client/vps/${encodedId}/console/resize`}
      ctrlAltDelEndpoint={`/api/client/vps/${encodedId}/console/ctrl-alt-del`}
      powerEndpoint={`/api/client/vps/${encodedId}/action`}
      credentialsEndpoint={`/api/client/vps/${encodedId}/credentials`}
      serverName={serverName}
      backHref={`/client-area/vps/${encodedId}`}
      monitoringHref={`/client-area/vps/${encodedId}#monitoring`}
    />
  )
}
