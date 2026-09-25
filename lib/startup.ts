/**
 * Application startup initialization sequence
 * Runs once on first database access to ensure everything is ready
 * Call validateConfig() before calling this
 */

import { prisma } from './db'
import { config, validateConfig } from './config'
import bcrypt from 'bcryptjs'
import { getStartupSchemaCheck } from "@/lib/startup-schema-check"

let initialized = false

export async function ensureStartup(): Promise<void> {
  if (initialized) {
    return
  }

  console.log('[Startup] Initializing cloud application...')

  try {
    // Validate config before proceeding
    validateConfig()

    // Step 1: Test database connection
    console.log('[Startup] Testing database connection...')
    await prisma.adminSetting.findFirst({ select: { id: true } })
    console.log('[Startup] ✓ Database connection successful')

    // Step 1b: Validate enterprise schema/migration compatibility.
    const schemaCheck = await getStartupSchemaCheck(true)
    if (!schemaCheck.ok) {
      console.warn("[Startup] ⚠ Enterprise networking safe mode enabled")
      console.warn(`[Startup] Missing tables: ${schemaCheck.missingTables.join(", ") || "none"}`)
      console.warn(`[Startup] Pending migrations: ${schemaCheck.pendingMigrations.join(", ") || "none"}`)
      console.warn(`[Startup] Failed migrations: ${schemaCheck.failedMigrations.join(", ") || "none"}`)
    } else {
      console.log("[Startup] ✓ Enterprise schema checks passed")
    }

    // Step 2: Ensure admin user exists
    console.log('[Startup] Checking admin user...')
    const adminEmail = config.admin.email.toLowerCase()

    const existingAdmin = await prisma.adminProfile.findUnique({
      where: { email: adminEmail },
    })

    if (!existingAdmin) {
      console.log('[Startup] Creating default admin user...')
      const hashedPassword = await bcrypt.hash(config.admin.password, 10)

      await prisma.adminProfile.create({
        data: {
          email: adminEmail,
          username: adminEmail.split('@')[0],
          displayName: config.admin.displayName,
          hashedPassword,
        },
      })

      console.log(`[Startup] ✓ Admin user created: ${config.admin.email}`)
    } else {
      console.log(`[Startup] ✓ Admin user exists: ${config.admin.email}`)
    }

    // Step 3: Initialize default settings
    console.log('[Startup] Initializing settings...')
    const pricingConfig = await prisma.adminSetting.findUnique({
      where: { key: 'pricing_config' },
    })

    if (!pricingConfig) {
      await prisma.adminSetting.create({
        data: {
          key: 'pricing_config',
          value: {
            currency: config.pricing.defaultCurrency,
            taxRate: config.pricing.defaultTaxRate,
            discounts: config.pricing.discounts,
          },
          description: 'Pricing configuration for the platform',
        },
      })
      console.log('[Startup] ✓ Pricing settings initialized')
    }

    initialized = true
    console.log('[Startup] ✓ Application initialization complete')
  } catch (error) {
    console.error('[Startup] ✗ Initialization failed:')
    if (error instanceof Error) {
      console.error(error.message)
      console.error(error.stack)
    }
    throw error
  }
}

export function isInitialized(): boolean {
  return initialized
}
