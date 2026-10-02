import { NextResponse } from "next/server"
import { readFileSync } from "node:fs"
import { join } from "node:path"

export async function GET() {
  try {
    const releasesDir = join(process.cwd(), "public", "releases")
    const { readdirSync } = await import("node:fs")
    const files = readdirSync(releasesDir).filter(
      (f) => /^zws-cloud-panel-\d+\.\d+\.\d+\.tar\.gz$/.test(f)
    )
    
    if (files.length === 0) {
      return new NextResponse("No release found", { status: 404 })
    }
    
    // Sort descending by semver to match the release endpoint exactly.
    files.sort((a, b) => {
      const av = a.replace("zws-cloud-panel-", "").replace(".tar.gz", "")
      const bv = b.replace("zws-cloud-panel-", "").replace(".tar.gz", "")
      return bv.localeCompare(av, undefined, { numeric: true, sensitivity: "base" })
    })
    
    const latest = files[0]
    const sha256Path = join(releasesDir, `${latest}.sha256`)
    
    try {
      const sha256 = readFileSync(sha256Path, "utf8").trim()
      return new NextResponse(sha256, {
        headers: {
          "Content-Type": "text/plain",
          "Cache-Control": "no-store",
        },
      })
    } catch {
      return new NextResponse("Checksum not found", { status: 404 })
    }
  } catch {
    return new NextResponse("Release checksum not found", { status: 404 })
  }
}
