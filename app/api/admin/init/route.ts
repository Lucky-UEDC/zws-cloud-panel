import { NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { prisma } from "@/lib/db"

/**
 * This endpoint initializes the admin user from environment variables
 * Call POST /api/admin/init to create the admin user
 */

export async function POST() {
  try {
    // Block this endpoint in production if any admin already exists.
    // This prevents unauthenticated admin account creation post-install.
    if (process.env.NODE_ENV === "production") {
      const adminCount = await prisma.adminProfile.count()
      if (adminCount > 0) {
        return NextResponse.json(
          { error: "Forbidden: admin already initialized" },
          { status: 403 }
        )
      }
    }

    const adminEmail = process.env.ADMIN_EMAIL
    const adminPassword = process.env.ADMIN_PASSWORD
    const adminDisplayName = process.env.ADMIN_DISPLAY_NAME || "Admin"

    if (!adminEmail || !adminPassword) {
      return NextResponse.json(
        { error: "Admin credentials not configured in environment" },
        { status: 400 }
      )
    }

    // Check if admin user already exists
    const existingAdmin = await prisma.adminProfile.findUnique({
      where: { email: adminEmail.toLowerCase() },
    })

    if (existingAdmin) {
      return NextResponse.json({
        success: true,
        message: "Admin user already exists",
        email: adminEmail,
      })
    }

    // Hash the password
    const hashedPassword = await bcrypt.hash(adminPassword, 10)

    // Create admin profile using Prisma
    const adminUser = await prisma.adminProfile.create({
      data: {
        email: adminEmail.toLowerCase(),
        username: adminEmail.split("@")[0],
        displayName: adminDisplayName,
        hashedPassword,
      },
    })

    return NextResponse.json({
      success: true,
      message: "Admin user created successfully",
      email: adminEmail,
      displayName: adminDisplayName,
    })
  } catch (error) {
    console.error("Admin init error:", error)
    return NextResponse.json(
      { error: "Internal server error", details: String(error) },
      { status: 500 }
    )
  }
}
