#!/usr/bin/env node

/**
 * Admin User Seeding Script
 * This script creates the admin user in PostgreSQL with the credentials from environment variables.
 * Run with: pnpm seed:admin
 * 
 * Required environment variables:
 * - DB_CONNECTION/DB_HOST/DB_PORT/DB_DATABASE/DB_USERNAME/DB_PASSWORD/DB_SCHEMA
 * - ADMIN_EMAIL: Admin user email (e.g., samvpslio@gmail.com)
 * - ADMIN_PASSWORD: Admin user password
 * - ADMIN_DISPLAY_NAME: Display name for admin (optional, defaults to "Admin")
 */

import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { assertDatabaseUrl } from '../lib/db-url'
import { publicOrigin } from '../lib/public-url'

assertDatabaseUrl()

const adminEmail = process.env.ADMIN_EMAIL
const adminPassword = process.env.ADMIN_PASSWORD
const adminDisplayName = process.env.ADMIN_DISPLAY_NAME || 'Admin'

// Validate required environment variables
if (!adminEmail) {
  console.error('❌ Missing environment variable: ADMIN_EMAIL')
  console.error('   Example: ADMIN_EMAIL=samvpslio@gmail.com')
  process.exit(1)
}

if (!adminPassword) {
  console.error('❌ Missing environment variable: ADMIN_PASSWORD')
  console.error('   Example: ADMIN_PASSWORD=CHANGE_ME_STRONG_PASSWORD')
  process.exit(1)
}

const requiredAdminEmail = adminEmail as string
const requiredAdminPassword = adminPassword as string

const prisma = new PrismaClient()

async function seedAdmin() {
  try {
    console.log(`\n🔐 Starting admin user setup for: ${requiredAdminEmail}\n`)

    // Check if admin user already exists
    console.log('🔍 Checking for existing admin user...')
    const existingAdmin = await prisma.adminProfile.findUnique({
      where: { email: requiredAdminEmail.toLowerCase() },
    })

    if (existingAdmin) {
      console.log(`✓ Admin user already exists: ${existingAdmin.email}`)
      console.log('  Updating admin access...\n')

      const hashedPassword = await bcrypt.hash(requiredAdminPassword, 10)
      await prisma.adminProfile.update({
        where: { id: existingAdmin.id },
        data: { hashedPassword, role: 'admin', isActive: true },
      })

      console.log('✓ Admin user updated successfully\n')
      printLoginInfo()
      return
    }

    // Create new admin user
    console.log('✓ Admin user not found, creating new user...')
    const hashedPassword = await bcrypt.hash(requiredAdminPassword, 10)

    const newAdmin = await prisma.adminProfile.create({
      data: {
        email: requiredAdminEmail.toLowerCase(),
        username: requiredAdminEmail.split('@')[0],
        displayName: adminDisplayName,
        hashedPassword,
        role: 'admin',
        isActive: true,
      },
    })

    console.log('✓ Admin user created successfully!\n')
    printLoginInfo()
  } catch (error) {
    console.error('❌ Unexpected error:', error instanceof Error ? error.message : String(error))
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

function printLoginInfo() {
  const appUrl = publicOrigin()

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('✅ Admin user ready for login:')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log(`📧 Email:    ${requiredAdminEmail}`)
  console.log('🔑 Password: the configured admin password')
  console.log(`📍 Login URL: ${appUrl}/zwsloginsam`)
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
}

// Run the seed function
seedAdmin()
