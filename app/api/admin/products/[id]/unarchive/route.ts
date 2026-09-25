import { NextResponse } from "next/server"

export async function PATCH() {
  return NextResponse.json({ success: false, error: "Product unarchive has been removed. Use draft, hidden, or delete instead." }, { status: 410 })
}
