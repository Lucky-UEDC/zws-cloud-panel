import { NextResponse } from "next/server"
import { getPublicOperatingSystems } from "@/lib/public-operating-systems"

// Public OS list used by /configure and /checkout.
// Only returns active Proxmox VM-template based OS records (no ISO/manual/inactive).
export async function GET() {
  try {
    return NextResponse.json(await getPublicOperatingSystems())
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Request failed" }, { status: 500 })
  }
}
