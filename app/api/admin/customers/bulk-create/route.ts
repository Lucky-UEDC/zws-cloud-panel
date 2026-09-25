import { NextRequest, NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { prisma } from "@/lib/db"
import { getAdminFromCookies } from "@/lib/server-auth"
import { isAdminLikeRole } from "@/lib/admin-rbac"
import { createPanelLog } from "@/lib/panel-log"

const MAX_BULK_COUNT = 5000
const BATCH_SIZE = 50

function validateDomain(domain: string) {
  return /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z]{2,})+$/.test(domain)
}

function generateEmail(prefix: string, index: number, domain: string) {
  return `${prefix}${index}@${domain}`.toLowerCase()
}

export async function POST(request: NextRequest) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !isAdminLikeRole(admin.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  }

  const count = Math.floor(Number(body?.count || 0))
  const emailPrefix = String(body?.emailPrefix || "").trim().toLowerCase()
  const domain = String(body?.domain || "").trim().toLowerCase()
  const defaultPassword = String(body?.defaultPassword || "")
  const dryRun = Boolean(body?.dryRun)

  if (!count || count < 1 || count > MAX_BULK_COUNT) {
    return NextResponse.json({ error: `Count must be between 1 and ${MAX_BULK_COUNT}` }, { status: 400 })
  }
  if (!emailPrefix || !/^[a-z0-9._-]+$/.test(emailPrefix)) {
    return NextResponse.json({ error: "Email prefix must contain only lowercase letters, numbers, dots, hyphens, or underscores" }, { status: 400 })
  }
  if (!domain || !validateDomain(domain)) {
    return NextResponse.json({ error: "Invalid domain format" }, { status: 400 })
  }
  if (!defaultPassword || defaultPassword.length < 12) {
    return NextResponse.json({ error: "Password must be at least 12 characters" }, { status: 400 })
  }

  // Find starting index to avoid collision with existing accounts on this domain
  const existingCount = await prisma.customer.count({
    where: { email: { endsWith: `@${domain}` } },
  })
  const startIndex = existingCount + 1

  if (dryRun) {
    const previewEmails = Array.from({ length: Math.min(count, 5) }, (_, i) =>
      generateEmail(emailPrefix, startIndex + i, domain)
    )
    return NextResponse.json({
      dryRun: true,
      count,
      startIndex,
      previewEmails,
      totalToCreate: count,
      message: `Dry run: would create ${count} accounts starting at index ${startIndex}`,
    })
  }

  // Pre-hash once and reuse — avoids 5000 × bcrypt overhead
  const sharedHash = await bcrypt.hash(defaultPassword, 10)

  let created = 0
  let failed = 0
  const errors: string[] = []

  for (let batchStart = 0; batchStart < count; batchStart += BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + BATCH_SIZE, count)
    const batch = Array.from({ length: batchEnd - batchStart }, (_, i) => {
      const index = startIndex + batchStart + i
      return {
        email: generateEmail(emailPrefix, index, domain),
        hashedPassword: sharedHash,
        status: "ACTIVE" as const,
        isActive: true,
        name: `${emailPrefix}${index}`,
      }
    })

    try {
      await prisma.$transaction(
        batch.map((data) =>
          prisma.customer.create({
            data,
            select: { id: true },
          })
        )
      )
      created += batch.length
    } catch (err: any) {
      // On batch failure, try individual inserts to skip duplicates
      for (const data of batch) {
        try {
          await prisma.customer.create({ data, select: { id: true } })
          created++
        } catch (innerErr: any) {
          failed++
          if (errors.length < 10) {
            errors.push(`${data.email}: ${innerErr?.message?.slice(0, 100) || "unknown"}`)
          }
        }
      }
    }
  }

  await createPanelLog({
    category: "Admin",
    level: "info",
    message: "bulk_account_creation",
    actorEmail: admin.email,
    metadata: {
      count,
      created,
      failed,
      emailPrefix,
      domain,
      startIndex,
      adminEmail: admin.email,
    },
  }).catch(() => null)

  return NextResponse.json({
    success: true,
    count,
    created,
    failed,
    skipped: count - created - failed,
    errors: errors.length ? errors : undefined,
    startIndex,
    message: `Created ${created} of ${count} accounts`,
  })
}
