import { NextResponse } from "next/server"
import { getEnterpriseNetworkingGate } from "@/lib/startup-schema-check"

export async function blockWhenEnterpriseNetworkingDisabled() {
  const gate = await getEnterpriseNetworkingGate()
  if (gate.enabled) return null
  return NextResponse.json({
    success: false,
    error: gate.reason || "Enterprise networking is temporarily disabled.",
    errorKind: "migration_missing",
    startupSchema: gate.startup,
  }, { status: 503 })
}

