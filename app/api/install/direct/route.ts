import { NextResponse } from "next/server"
import { readFileSync } from "node:fs"
import { join } from "node:path"

export async function GET() {
  try {
    const scriptPath = join(process.cwd(), "installer", "install-direct.sh")
    const script = readFileSync(scriptPath, "utf8")
    
    return new NextResponse(script, {
      headers: {
        "Content-Type": "application/x-shellscript",
        "Cache-Control": "no-store",
      },
    })
  } catch {
    return new NextResponse("Installer script not found", { status: 404 })
  }
}