#!/usr/bin/env node

import "dotenv/config"

import { PrismaClient } from "@prisma/client"
import bcrypt from "bcryptjs"
import { assertDatabaseUrl } from "../lib/db-url"

assertDatabaseUrl()

const adminEmail = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase()
const adminPassword = String(process.env.ZWS_ADMIN_PASSWORD || "")
const adminDisplayName = String(process.env.ADMIN_DISPLAY_NAME || "Administrator").trim() || "Administrator"

if (!adminEmail) {
  console.error("Missing ADMIN_EMAIL.")
  process.exit(1)
}

if (!adminPassword) {
  console.error("Missing one-run admin password input.")
  process.exit(1)
}

if (adminPassword.length < 10) {
  console.error("Admin password must be at least 10 characters.")
  process.exit(1)
}

const prisma = new PrismaClient()

function usernameFromEmail(email: string) {
  return email.split("@")[0]?.replace(/[^a-zA-Z0-9_.-]/g, "_") || "admin"
}

async function main() {
  const hashedPassword = await bcrypt.hash(adminPassword, 10)
  const existing = await prisma.adminProfile.findUnique({
    where: { email: adminEmail },
  })

  if (existing) {
    await prisma.adminProfile.update({
      where: { id: existing.id },
      data: {
        hashedPassword,
        role: "admin",
        isActive: true,
      },
    })
  } else {
    const baseUsername = usernameFromEmail(adminEmail)
    const usernameOwner = await prisma.adminProfile.findUnique({
      where: { username: baseUsername },
    })
    const username = usernameOwner ? `${baseUsername}_admin` : baseUsername

    await prisma.adminProfile.create({
      data: {
        email: adminEmail,
        username,
        displayName: adminDisplayName,
        hashedPassword,
        role: "admin",
        isActive: true,
      },
    })
  }

  console.log(`Admin user ready: ${adminEmail}`)
}

main()
  .catch((error) => {
    console.error("Admin user setup failed:", error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
