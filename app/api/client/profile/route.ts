import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getClientFromCookies } from "@/lib/server-auth"
import { billingAddressProfilePatch, normalizeBillingAddress } from "@/lib/checkout-identity"

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return {}
}

export async function GET() {
  const client = await getClientFromCookies()
  if (!client?.sub || !client.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const customer = await prisma.customer.findUnique({
    where: { id: String(client.sub) },
    select: {
      id: true,
      email: true,
      name: true,
      phone: true,
      phoneVerified: true,
      phoneVerifiedAt: true,
      whatsappOptIn: true,
      company: true,
      addressLine1: true,
      addressLine2: true,
      city: true,
      state: true,
      postalCode: true,
      country: true,
      gstin: true,
      panNumber: true,
      address: true,
      metadata: true,
      createdAt: true,
      walletBalance: true,
    },
  })

  if (!customer) {
    return NextResponse.json({ error: "Customer not found" }, { status: 404 })
  }

  const metadata = asRecord(customer.metadata)
  const address = asRecord(customer.address)

  return NextResponse.json({
    profile: {
      id: customer.id,
      email: customer.email,
      name: customer.name,
      phone: customer.phone,
      phoneVerified: customer.phoneVerified,
      phoneVerifiedAt: customer.phoneVerifiedAt,
      whatsappOptIn: customer.whatsappOptIn,
      company: customer.company,
      address: {
        line1: String(customer.addressLine1 || address.line1 || ""),
        addressLine1: String(customer.addressLine1 || address.line1 || ""),
        line2: String(customer.addressLine2 || address.line2 || ""),
        addressLine2: String(customer.addressLine2 || address.line2 || ""),
        city: String(customer.city || address.city || ""),
        state: String(customer.state || address.state || ""),
        postalCode: String(customer.postalCode || address.postalCode || ""),
        country: String(customer.country || address.country || ""),
        countryCode: String(metadata.billingCountryCode || address.countryCode || ""),
        stateCode: String(metadata.billingStateCode || address.stateCode || ""),
        gstin: String(customer.gstin || ""),
        panNumber: String(customer.panNumber || ""),
      },
      kyc: {
        status: String(metadata.kycStatus || "not_submitted"),
        legalName: String(metadata.kycLegalName || ""),
        taxId: String(metadata.kycTaxId || ""),
        documentType: String(metadata.kycDocumentType || ""),
        documentNumber: String(metadata.kycDocumentNumber || ""),
        submittedAt: metadata.kycSubmittedAt ? String(metadata.kycSubmittedAt) : null,
      },
      walletBalance: Number(customer.walletBalance || 0),
      joinedAt: customer.createdAt,
    },
  })
}

export async function PUT(request: NextRequest) {
  const client = await getClientFromCookies()
  if (!client?.sub || !client.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = (await request.json()) as {
    name?: string
    phone?: string
    company?: string
    address?: {
      line1?: string
      addressLine1?: string
      line2?: string
      addressLine2?: string
      city?: string
      state?: string
      postalCode?: string
      country?: string
      countryCode?: string
      stateCode?: string
      gstin?: string
      panNumber?: string
    }
    kyc?: {
      legalName?: string
      taxId?: string
      documentType?: string
      documentNumber?: string
    }
  }

  const current = await prisma.customer.findUnique({
    where: { id: String(client.sub) },
    select: { metadata: true, phone: true },
  })

  if (!current) {
    return NextResponse.json({ error: "Customer not found" }, { status: 404 })
  }

  const existingMetadata = asRecord(current.metadata)
  const nextMetadata: Record<string, unknown> = { ...existingMetadata }
  let addressPatch: ReturnType<typeof billingAddressProfilePatch> | undefined
  if (body.address) {
    try {
      addressPatch = billingAddressProfilePatch(normalizeBillingAddress({
        addressLine1: body.address.addressLine1 || body.address.line1,
        addressLine2: body.address.addressLine2 || body.address.line2,
        city: body.address.city,
        state: body.address.state,
        country: body.address.country,
        postalCode: body.address.postalCode,
        gstin: body.address.gstin,
        panNumber: body.address.panNumber,
      }))
    } catch (error: any) {
      if (error?.code === "billing_address_required") {
        return NextResponse.json({
          error: "Complete billing address is required",
          code: "billing_address_required",
          missingFields: Array.isArray(error?.fields) ? error.fields : undefined,
        }, { status: 400 })
      }
      throw error
    }
    if (typeof body.address.countryCode === "string") {
      nextMetadata.billingCountryCode = body.address.countryCode.trim().toUpperCase() || null
    }
    if (typeof body.address.stateCode === "string") {
      nextMetadata.billingStateCode = body.address.stateCode.trim().toUpperCase() || null
    }
  }

  if (body.kyc) {
    const legalName = String(body.kyc.legalName || "").trim()
    const taxId = String(body.kyc.taxId || "").trim()
    const documentType = String(body.kyc.documentType || "").trim()
    const documentNumber = String(body.kyc.documentNumber || "").trim()

    if (!legalName || !taxId || !documentType || !documentNumber) {
      return NextResponse.json({ error: "Complete KYC details are required" }, { status: 400 })
    }

    nextMetadata.kycLegalName = legalName
    nextMetadata.kycTaxId = taxId
    nextMetadata.kycDocumentType = documentType
    nextMetadata.kycDocumentNumber = documentNumber
    nextMetadata.kycStatus = "pending_review"
    nextMetadata.kycSubmittedAt = new Date().toISOString()
  }

  const nextPhone = typeof body.phone === "string" ? body.phone.trim() || null : undefined
  const phoneChanged = nextPhone !== undefined && String(nextPhone || "") !== String(current.phone || "")
  if (phoneChanged) {
    return NextResponse.json({
      error: "Phone changes require old and new number OTP verification.",
      code: "secure_phone_change_required",
      endpoint: "/api/client/security/phone-change",
    }, { status: 409 })
  }

  const updated = await prisma.customer.update({
    where: { id: String(client.sub) },
    data: {
      name: typeof body.name === "string" ? body.name.trim() || null : undefined,
      phone: nextPhone,
      company: typeof body.company === "string" ? body.company.trim() || null : undefined,
      ...(addressPatch || {}),
      metadata: Object.keys(nextMetadata).length ? (nextMetadata as any) : undefined,
    },
    select: {
      id: true,
      email: true,
      name: true,
      phone: true,
      company: true,
      address: true,
      metadata: true,
    },
  })

  return NextResponse.json({ success: true, profile: updated })
}
