import { NextRequest, NextResponse } from "next/server"
import { getWhatsAppSessionStatus } from "@/lib/whatsapp/status"
import { jsonError, noStoreHeaders, requireWhatsAppAdmin } from "../_shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  try {
    await requireWhatsAppAdmin(request)
    const status = await getWhatsAppSessionStatus()
    return NextResponse.json({
      connected: status.connected,
      number: status.number,
      ...status.raw,
      runtimeStatus: status.raw.status,
      status: status.effectiveStatus,
      effectiveStatus: status.effectiveStatus,
      healthy: status.healthy,
      healthReason: status.healthReason,
      lastPositiveSignalAt: status.lastPositiveSignalAt,
      lastMessageSentAt: status.lastMessageSentAt,
      lastDeliveryAckAt: status.lastDeliveryAckAt,
      sessionWritable: status.sessionWritable,
      sendAvailable: status.sendAvailable,
      queueHealthy: status.queueHealthy,
      deliveryOperational: status.deliveryOperational,
      sessionName: status.sessionName,
      workerHeartbeatFresh: status.workerHeartbeatFresh,
      lastHeartbeatAt: status.lastHeartbeatAt,
      activeProbeOk: status.activeProbeOk,
      evolution: status.evolution,
    }, { headers: noStoreHeaders })
  } catch (error) {
    return jsonError(error)
  }
}
