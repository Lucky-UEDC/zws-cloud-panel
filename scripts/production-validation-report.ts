import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

type Category =
  | "BUILD STATUS"
  | "DATABASE STATUS"
  | "MIGRATION STATUS"
  | "BACKUP STATUS"
  | "RESTORE STATUS"
  | "PROXMOX STATUS"
  | "WHATSAPP STATUS"
  | "SSL STATUS"
  | "SECURITY STATUS"

type Check = {
  category: Category
  name: string
  command: string
  args: string[]
  env?: Record<string, string>
}

type CheckResult = Awaited<ReturnType<typeof run>>

const liveBaseUrl = process.env.LIVE_BASE_URL || "https://aws.myrdphub.com"

function shellCheck(category: Category, name: string, script: string): Check {
  return { category, name, command: "bash", args: ["-lc", script] }
}

const checks: Check[] = [
  { category: "BUILD STATUS", name: "Prisma Schema", command: "pnpm", args: ["exec", "prisma", "validate"] },
  { category: "BUILD STATUS", name: "Typecheck", command: "pnpm", args: ["typecheck"] },
  { category: "BUILD STATUS", name: "Lint", command: "pnpm", args: ["lint"] },
  { category: "BUILD STATUS", name: "Unit Tests", command: "pnpm", args: ["test"] },
  { category: "BUILD STATUS", name: "Production Tests", command: "pnpm", args: ["test:production"] },
  { category: "BUILD STATUS", name: "Build", command: "pnpm", args: ["build"] },
  { category: "DATABASE STATUS", name: "Database Health", command: "pnpm", args: ["db:check"] },
  { category: "MIGRATION STATUS", name: "Migration Validation", command: "pnpm", args: ["db:validate:migrations"] },
  { category: "BACKUP STATUS", name: "Backup Artifact Detection", command: "pnpm", args: ["backup:detect"] },
  shellCheck("RESTORE STATUS", "Restore Validation", "${RESTORE_VALIDATION_CMD:?RESTORE_VALIDATION_CMD is required for final restore validation}"),
  shellCheck("PROXMOX STATUS", "Proxmox Validation", "${PROXMOX_VALIDATION_CMD:?PROXMOX_VALIDATION_CMD is required for final Proxmox validation}"),
  shellCheck("WHATSAPP STATUS", "Evolution Validation", "${WHATSAPP_VALIDATION_CMD:?WHATSAPP_VALIDATION_CMD is required for final WhatsApp validation}"),
  shellCheck("SSL STATUS", "HTTPS Health", `curl -fsS --max-time 20 ${JSON.stringify(`${liveBaseUrl}/api/health`)} >/dev/null && openssl s_client -servername ${JSON.stringify(new URL(liveBaseUrl).hostname)} -connect ${JSON.stringify(`${new URL(liveBaseUrl).hostname}:443`)} </dev/null 2>/dev/null | openssl x509 -checkend 86400 -noout`),
  { category: "SECURITY STATUS", name: "Critical Audit", command: "pnpm", args: ["audit", "--prod", "--audit-level", "critical"] },
]

async function run(check: Check) {
  const started = Date.now()
  try {
    const result = await execFileAsync(check.command, check.args, {
      env: { ...process.env, ...(check.env || {}) },
      maxBuffer: 1024 * 1024 * 20,
    })
    return {
      category: check.category,
      name: check.name,
      status: "PASS",
      durationMs: Date.now() - started,
      output: [result.stdout, result.stderr].filter(Boolean).join("\n").slice(-2000),
    }
  } catch (error: any) {
    return {
      category: check.category,
      name: check.name,
      status: "FAIL",
      durationMs: Date.now() - started,
      output: [error?.stdout, error?.stderr, error?.message].filter(Boolean).join("\n").slice(-4000),
    }
  }
}

const results: CheckResult[] = []
for (const check of checks) {
  console.log(`[validation] ${check.category}: ${check.name}`)
  results.push(await run(check))
}

const categories = Array.from(new Set(checks.map((check) => check.category))).map((category) => {
  const categoryResults = results.filter((result) => result.category === category)
  return {
    category,
    status: categoryResults.every((result) => result.status === "PASS") ? "PASS" : "FAIL",
    checks: categoryResults,
  }
})

const report = {
  generatedAt: new Date().toISOString(),
  overall: categories.every((category) => category.status === "PASS") ? "PASS" : "FAIL",
  categories,
}

console.log(JSON.stringify(report, null, 2))
process.exitCode = report.overall === "PASS" ? 0 : 1
