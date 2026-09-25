import { NextRequest, NextResponse } from "next/server"
import { noStoreHeaders, requireWhatsAppAdmin } from "../_shared"
import { scanWhatsAppMigration } from "@/lib/whatsapp/migration-checker"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  await requireWhatsAppAdmin(request)
  const findings = scanWhatsAppMigration(process.cwd())
  return NextResponse.json({ ok: findings.length === 0, findings }, { headers: noStoreHeaders })
}
