import { NextRequest, NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { prisma } from "@/lib/db"
import { getAdminFromCookies } from "@/lib/server-auth"
import { isAdminLikeRole } from "@/lib/admin-rbac"
import { createAuditLog } from "@/lib/audit-log"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function normalizeEmail(value: unknown) {
  return String(value || "").trim().toLowerCase()
}

function isValidEmail(value: string) {
  return /^\S+@\S+\.\S+$/.test(value)
}

const BATCH_SIZE = 100
const MAX_ROWS = 1000

export async function POST(request: NextRequest) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !isAdminLikeRole(admin.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const adminRow = await prisma.adminProfile.findUnique({
    where: { email: String(admin.email).toLowerCase() },
    select: { id: true },
  })
  if (!adminRow) return NextResponse.json({ error: "Admin not found" }, { status: 404 })

  const body = await request.json().catch(() => null)
  if (!body || !Array.isArray(body.customers)) {
    return NextResponse.json({ error: "customers array is required" }, { status: 400 })
  }

  const rows = body.customers.slice(0, MAX_ROWS) as Array<{
    email?: string
    name?: string
    phone?: string
    password?: string
  }>

  const created: string[] = []
  const skipped: Array<{ email: string; reason: string }> = []
  const failed: Array<{ email: string; reason: string }> = []

  // Validate all rows upfront
  const validRows: Array<{ email: string; name: string; phone: string | null; password: string | null }> = []
  for (const row of rows) {
    const email = normalizeEmail(row.email)
    const name = String(row.name || "").trim()
    if (!email || !isValidEmail(email)) {
      failed.push({ email: email || "(empty)", reason: "invalid email" })
      continue
    }
    if (!name) {
      failed.push({ email, reason: "name is required" })
      continue
    }
    validRows.push({
      email,
      name,
      phone: String(row.phone || "").trim() || null,
      password: String(row.password || "").trim() || null,
    })
  }

  // Check which emails already exist
  const emails = validRows.map((r) => r.email)
  const existing = await prisma.customer.findMany({
    where: { email: { in: emails } },
    select: { email: true },
  })
  const existingSet = new Set(existing.map((e) => e.email))

  const toCreate = validRows.filter((row) => {
    if (existingSet.has(row.email)) {
      skipped.push({ email: row.email, reason: "email already exists" })
      return false
    }
    return true
  })

  // Hash passwords in parallel (bounded)
  const passwordHashes = await Promise.all(
    toCreate.map((row) => (row.password ? bcrypt.hash(row.password, 10) : Promise.resolve(null)))
  )

  // Insert in batches of 100
  for (let i = 0; i < toCreate.length; i += BATCH_SIZE) {
    const batch = toCreate.slice(i, i + BATCH_SIZE)
    const hashes = passwordHashes.slice(i, i + BATCH_SIZE)
    try {
      await prisma.$transaction(
        batch.map((row, j) =>
          prisma.customer.create({
            data: {
              email: row.email,
              name: row.name,
              phone: row.phone,
              hashedPassword: hashes[j],
              isActive: true,
              status: "ACTIVE",
            },
          })
        )
      )
      created.push(...batch.map((r) => r.email))
    } catch (error: any) {
      // On batch failure, try row-by-row to maximize success
      for (let j = 0; j < batch.length; j++) {
        const row = batch[j]
        try {
          await prisma.customer.create({
            data: {
              email: row.email,
              name: row.name,
              phone: row.phone,
              hashedPassword: hashes[j],
              isActive: true,
              status: "ACTIVE",
            },
          })
          created.push(row.email)
        } catch (rowError: any) {
          failed.push({ email: row.email, reason: rowError?.message || "create failed" })
        }
      }
    }
  }

  if (created.length) {
    await createAuditLog({
      adminId: adminRow.id,
      action: "CUSTOMERS_BULK_IMPORTED",
      newValue: { count: created.length, skipped: skipped.length, failed: failed.length },
    }).catch(() => null)
  }

  return NextResponse.json({
    success: true,
    created: created.length,
    skipped: skipped.length,
    failed: failed.length,
    skippedDetails: skipped,
    failedDetails: failed,
  }, { status: 200 })
}
