import { NextResponse } from "next/server"
import { readFileSync } from "node:fs"
import { join } from "node:path"

export async function GET() {
  try {
    // Find the latest release archive
    const releasesDir = join(process.cwd(), "public", "releases")
    const { readdirSync } = await import("node:fs")
    const files = readdirSync(releasesDir).filter(
      (f) => /^zws-cloud-panel-\d+\.\d+\.\d+\.tar\.gz$/.test(f)
    )

    if (files.length === 0) {
      return new NextResponse("No release found", { status: 404 })
    }

    // Sort descending by semver so the newest build is served first.
    files.sort((a, b) => {
      const av = a.replace("zws-cloud-panel-", "").replace(".tar.gz", "")
      const bv = b.replace("zws-cloud-panel-", "").replace(".tar.gz", "")
      return bv.localeCompare(av, undefined, { numeric: true, sensitivity: "base" })
    })

    const latest = files[0]
    const archivePath = join(process.cwd(), "public", "releases", latest)
    const archive = readFileSync(archivePath)

    return new NextResponse(archive, {
      headers: {
        "Content-Type": "application/gzip",
        "Content-Disposition": `attachment; filename="${latest}"`,
        "Cache-Control": "no-store",
      },
    })
  } catch {
    return new NextResponse("Release archive not found", { status: 404 })
  }
}
