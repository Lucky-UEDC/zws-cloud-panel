import "dotenv/config"
import { prisma } from "@/lib/db"
import { assertDatabaseUrl } from "@/lib/db-url"
import { formatSchemaHealthProblems, getSchemaHealthReport } from "@/lib/schema-health"

async function main() {
  assertDatabaseUrl()
  const report = await getSchemaHealthReport({ fullPrismaShape: false })
  const problems = formatSchemaHealthProblems(report)
  if (!problems.length) {
    console.log("[startup-schema-guard] schema ok")
    return
  }

  console.error("[startup-schema-guard] database schema is not compatible with this application version")
  for (const problem of problems) console.error(`[startup-schema-guard] ${problem}`)
  process.exitCode = 1
}

main()
  .catch((error) => {
    console.error("[startup-schema-guard] failed", error?.message || error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect?.().catch(() => undefined)
  })
