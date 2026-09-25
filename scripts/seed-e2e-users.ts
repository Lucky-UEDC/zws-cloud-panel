#!/usr/bin/env node

import { PrismaClient } from "@prisma/client"
import bcrypt from "bcryptjs"
import { assertDatabaseUrl } from "../lib/db-url"

assertDatabaseUrl()

const prisma = new PrismaClient()

const adminEmail = String(process.env.ZWS_E2E_ADMIN_EMAIL || "").trim().toLowerCase()
const adminPassword = String(process.env.ZWS_E2E_ADMIN_PASSWORD || "")
const customerEmail = String(process.env.ZWS_E2E_CUSTOMER_EMAIL || "").trim().toLowerCase()
const customerPassword = String(process.env.ZWS_E2E_CUSTOMER_PASSWORD || "")

function requireValue(name: string, value: string) {
  if (!value) throw new Error(`${name} is required to seed E2E users.`)
  if (name.includes("PASSWORD") && value.length < 12) throw new Error(`${name} must be at least 12 characters.`)
}

async function main() {
  requireValue("ZWS_E2E_ADMIN_EMAIL", adminEmail)
  requireValue("ZWS_E2E_ADMIN_PASSWORD", adminPassword)
  requireValue("ZWS_E2E_CUSTOMER_EMAIL", customerEmail)
  requireValue("ZWS_E2E_CUSTOMER_PASSWORD", customerPassword)

  const [adminHash, customerHash] = await Promise.all([
    bcrypt.hash(adminPassword, 10),
    bcrypt.hash(customerPassword, 10),
  ])

  await prisma.adminProfile.upsert({
    where: { email: adminEmail },
    create: {
      email: adminEmail,
      username: adminEmail.split("@")[0].replace(/[^a-z0-9_-]/gi, "_").slice(0, 32),
      displayName: "ZWS E2E Admin",
      hashedPassword: adminHash,
      role: "admin",
      isActive: true,
      twoFactorEnabled: false,
      whatsappMfaEnabled: false,
      phoneVerified: false,
    },
    update: {
      displayName: "ZWS E2E Admin",
      hashedPassword: adminHash,
      role: "admin",
      isActive: true,
      twoFactorEnabled: false,
      whatsappMfaEnabled: false,
      phoneVerified: false,
    },
  })

  await prisma.customer.upsert({
    where: { email: customerEmail },
    create: {
      email: customerEmail,
      name: "ZWS E2E Customer",
      hashedPassword: customerHash,
      isActive: true,
      status: "ACTIVE",
      emailVerifiedAt: new Date(),
      metadata: { e2e: true },
    },
    update: {
      name: "ZWS E2E Customer",
      hashedPassword: customerHash,
      isActive: true,
      status: "ACTIVE",
      emailVerifiedAt: new Date(),
      metadata: { e2e: true },
    },
  })

  console.log("E2E admin and customer users are ready.")
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
