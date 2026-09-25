import "dotenv/config"
import { prisma } from "@/lib/db"
import { assertDatabaseUrl } from "@/lib/db-url"
import { formatSchemaHealthProblems, getSchemaHealthReport } from "@/lib/schema-health"

async function main() {
  assertDatabaseUrl()
  const report = await getSchemaHealthReport({ fullPrismaShape: true })
  const problems = formatSchemaHealthProblems(report)

  if (problems.length) {
    console.error("Database schema mismatch detected:")
    for (const problem of problems) console.error(`- ${problem}`)
  } else {
    console.log("Database schema matches Prisma schema and required production columns.")
  }

  console.log(JSON.stringify(report, null, 2))
  if (!report.ok) process.exitCode = 1
}

main()
  .catch((error) => {
    console.error("Database schema check failed:", error?.message || error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect?.().catch(() => undefined)
  })
