import { NextResponse } from "next/server"
import { getAdminFromCookies } from "@/lib/server-auth"

export async function GET() {
  try {
    const admin = await getAdminFromCookies()
    if (!admin?.email) {
      return NextResponse.json(
        { authenticated: false },
        { status: 401 }
      )
    }

    return NextResponse.json({
      authenticated: true,
      user: {
        email: admin.email,
        displayName: admin.displayName,
        role: admin.role,
      },
    })
  } catch {
    return NextResponse.json(
      { authenticated: false },
      { status: 401 }
    )
  }
}
