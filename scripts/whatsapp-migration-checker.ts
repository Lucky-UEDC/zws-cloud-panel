import { scanWhatsAppMigration } from "@/lib/whatsapp/migration-checker"

const findings = scanWhatsAppMigration(process.cwd())
if (!findings.length) {
  console.log("WhatsApp migration checker passed: no legacy paths found.")
  process.exit(0)
}

for (const finding of findings) {
  console.log(`${finding.file}:${finding.line} [${finding.rule}] ${finding.match}`)
  console.log(`  -> ${finding.recommendation}`)
}

process.exitCode = 1
