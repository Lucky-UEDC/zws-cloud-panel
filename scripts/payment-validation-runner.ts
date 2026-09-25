import "dotenv/config"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { prisma } from "@/lib/db"
import { PAYMENT_VALIDATION_COMMANDS } from "@/lib/payments/validation-runner"

const execFileAsync = promisify(execFile)
const runId = process.argv[2]

async function update(data: Record<string, unknown>) {
  if (!runId) return
  await (prisma as any).paymentValidationRun.update({ where: { id: runId }, data }).catch(() => null)
}

async function main() {
  const output: Record<string, any> = {}
  const failed: string[] = []
  await update({ status: "running", startedAt: new Date(), output })

  for (const [cmd, args] of PAYMENT_VALIDATION_COMMANDS) {
    const label = [cmd, ...args].join(" ")
    const startedAt = new Date().toISOString()
    try {
      const result = await execFileAsync(cmd, [...args], {
        cwd: process.cwd(),
        timeout: 20 * 60_000,
        maxBuffer: 1024 * 1024 * 8,
        env: process.env,
      })
      output[label] = {
        status: "passed",
        startedAt,
        completedAt: new Date().toISOString(),
        stdout: result.stdout?.slice(-40_000) || "",
        stderr: result.stderr?.slice(-40_000) || "",
      }
      await update({ output })
    } catch (error: any) {
      output[label] = {
        status: "failed",
        startedAt,
        completedAt: new Date().toISOString(),
        stdout: String(error?.stdout || "").slice(-40_000),
        stderr: String(error?.stderr || "").slice(-40_000),
        message: error?.message || String(error),
      }
      await update({
        status: "failed",
        output,
        errorMessage: `${label} failed`,
        completedAt: new Date(),
      })
      failed.push(label)
      break
    }
  }

  if (!runId) {
    console.log(JSON.stringify({ ok: failed.length === 0, failed, output }, null, 2))
    if (failed.length > 0) process.exitCode = 1
    return
  }
  if (failed.length > 0) return
  await update({ status: "passed", output, errorMessage: null, completedAt: new Date() })
}

main()
  .catch(async (error) => {
    await update({ status: "failed", errorMessage: error instanceof Error ? error.message : String(error), completedAt: new Date() })
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => null)
  })
