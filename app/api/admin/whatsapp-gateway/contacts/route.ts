import { NextResponse } from "next/server"
import { badRequest, jsonError, noStoreHeaders, requireGatewayAdmin } from "../_shared"
import { getGatewaySettings } from "@/lib/whatsapp-gateway/settings"
import { WhatsAppGatewayProvider } from "@/lib/whatsapp-gateway/client"
import { listGatewayContacts, upsertGatewayContact, syncGatewayContacts } from "@/lib/whatsapp-gateway/contacts"
import { gatewayContactInputSchema } from "@/lib/whatsapp-gateway/validate"
import { getAdminFromCookies } from "@/lib/server-auth"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function GET(request: Request) {
  try {
    await requireGatewayAdmin(request)
    const url = new URL(request.url)
    const result = await listGatewayContacts({
      page: Number(url.searchParams.get("page") || 1),
      pageSize: Number(url.searchParams.get("pageSize") || 20),
      search: url.searchParams.get("search") || undefined,
    })
    return NextResponse.json({ ok: true, ...result }, { headers: noStoreHeaders })
  } catch (error) {
    return jsonError(error)
  }
}

export async function POST(request: Request) {
  try {
    await requireGatewayAdmin(request)
    const body = await request.json().catch(() => badRequest("Invalid JSON body"))
    const parsed = gatewayContactInputSchema.safeParse(body)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      return badRequest(issue ? issue.message : "Invalid contact")
    }

    const admin = await getAdminFromCookies()
    const created = await upsertGatewayContact({
      phoneNumber: parsed.data.phone,
      name: parsed.data.name || undefined,
      email: parsed.data.email || undefined,
      createdBy: admin?.email ?? null,
    })

    const settings = await getGatewaySettings()
    if (settings.apiBaseUrl) {
      try {
        const provider = new WhatsAppGatewayProvider(settings)
        await provider.createContact({ phoneNumber: created.phoneNumber, name: created.name || undefined, email: created.email || undefined })
      } catch {
        // Local contact is persisted even when the provider push fails.
      }
    }

    return NextResponse.json({ ok: true, contact: { id: created.id, phoneNumber: created.phoneNumber, name: created.name, email: created.email } }, { headers: noStoreHeaders })
  } catch (error) {
    return jsonError(error)
  }
}

export async function PUT(request: Request) {
  try {
    await requireGatewayAdmin(request)
    const settings = await getGatewaySettings()
    if (!settings.apiBaseUrl) return badRequest("Gateway base URL is not configured")
    const provider = new WhatsAppGatewayProvider(settings)
    const result = await syncGatewayContacts(provider)
    return NextResponse.json({ ok: true, result }, { headers: noStoreHeaders })
  } catch (error) {
    return jsonError(error)
  }
}