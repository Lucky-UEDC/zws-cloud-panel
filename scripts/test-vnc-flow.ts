import "dotenv/config"
import { prisma } from "@/lib/db"
import { getVncEnvDebug, runVncDiagnostics } from "@/lib/vnc-diagnostics"

async function main() {
  const vmid = Number(process.argv[2])
  const node = String(process.argv[3] || "")

  if (!Number.isInteger(vmid) || !node.trim()) {
    console.error("Usage: pnpm tsx scripts/test-vnc-flow.ts <vmid> <node>")
    process.exitCode = 2
    return
  }

  const env = getVncEnvDebug()
  console.log(`ENV vnc_auth tokenConfigured=${env.tokenConfigured}`)

  const result = await runVncDiagnostics({ vmid, node })
  for (const step of result.steps) {
    const details = [
      step.status ? `status=${step.status}` : "",
      step.port ? `port=${step.port}` : "",
      step.hasTicket !== undefined ? `hasTicket=${step.hasTicket}` : "",
      step.length !== undefined ? `length=${step.length}` : "",
      step.compatible !== undefined ? `compatible=${step.compatible}` : "",
      step.skipped !== undefined ? `skipped=${step.skipped}` : "",
      step.message ? `message=${step.message}` : "",
    ].filter(Boolean).join(" ")
    console.log(`${step.ok ? "OK" : "FAIL"} ${step.step}${details ? ` ${details}` : ""}`)
  }

  if (result.error) console.log(`ERROR ${result.error}`)
  console.log(JSON.stringify(result, null, 2))
  process.exitCode = result.success ? 0 : 1
}

main()
  .catch((error) => {
    console.error(`FATAL ${error?.message || error}`)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect?.().catch(() => undefined)
  })
