#!/usr/bin/env node

import { PrismaClient } from "@prisma/client"
import bcrypt from "bcryptjs"
import { assertDatabaseUrl } from "../lib/db-url"
import { configuredSiteDomain } from "../lib/public-url"

assertDatabaseUrl()
const prisma = new PrismaClient()

const DEMO_EMAIL = process.env.ZWS_DEMO_EMAIL || `demo@${configuredSiteDomain() || "example.com"}`
const DEMO_PASSWORD = "Demo123"
const DEMO_NAME = "Demo Client"

async function seedDemoClient() {
  try {
    const hashedPassword = await bcrypt.hash(DEMO_PASSWORD, 10)

    const customer = await prisma.customer.upsert({
      where: { email: DEMO_EMAIL },
      create: {
        email: DEMO_EMAIL,
        name: DEMO_NAME,
        hashedPassword,
        isActive: true,
      },
      update: {
        name: DEMO_NAME,
        hashedPassword,
        isActive: true,
      },
    })

    console.log("✅ Demo client ready")
    console.log(`📧 Email: ${customer.email}`)
    console.log(`🔑 Password: ${DEMO_PASSWORD}`)
    console.log("📍 Login URL: /login")
  } catch (error) {
    console.error("❌ Failed to seed demo client:", error)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

seedDemoClient()
