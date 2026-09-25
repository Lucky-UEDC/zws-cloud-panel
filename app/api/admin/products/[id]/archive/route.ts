import { NextResponse } from "next/server"

export async function PATCH() {
  return NextResponse.json({ success: false, error: "Product archive has been removed. Use draft, hidden, or delete instead." }, { status: 410 })
}

export async function POST() {
  return NextResponse.json({ success: false, error: "Product archive has been removed. Use draft, hidden, or delete instead." }, { status: 410 })
}
