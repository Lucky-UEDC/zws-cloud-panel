import fs from "node:fs"
import path from "node:path"

export type WhatsAppMigrationFinding = {
  file: string
  line: number
  rule: string
  match: string
  recommendation: string
}

const ROOT_DIRS = ["app", "lib", "scripts", "components"]
const SKIP = new Set(["node_modules", ".next", "vendor", ".git"])
const RULES: Array<{ rule: string; pattern: RegExp; recommendation: string; allow?: RegExp }> = [
  {
    rule: "legacy_template_key",
    pattern: /\b(login_otp|signup_otp|password_reset_otp|device_verification_otp|mobile_verification)\b/,
    recommendation: "Use auth_login_otp, auth_signup_otp, auth_password_reset, or auth_device_verify.",
    allow: /(lib\/whatsapp\/migration-checker\.ts|lib\/whatsapp\/template-registry\.ts|lib\/email\/templates\.ts)$/,
  },
  {
    rule: "direct_send_message",
    pattern: /\.sendMessage\s*\(/,
    recommendation: "Use sendWhatsAppMessage() and keep direct sendMessage() inside lib/whatsapp/send.ts only.",
    allow: /lib\/whatsapp\/send\.ts$/,
  },
  {
    rule: "raw_enqueue_message",
    pattern: /enqueueWhatsAppMessage\s*\(|\bmessage\s*:\s*campaign\.message/,
    recommendation: "Use sendWhatsAppMessage() with templateKey and variables instead of pre-rendered message text.",
    allow: /lib\/whatsapp\/queue\.ts$/,
  },
  {
    rule: "deprecated_renderer",
    pattern: /renderWhatsAppTemplateByKey\s*\(|findWhatsAppTemplate\s*\(/,
    recommendation: "Use resolveAndRenderWhatsAppTemplate() or sendWhatsAppMessage().",
    allow: /lib\/whatsapp\/templates\.ts$/,
  },
  {
    rule: "template_body_rendering",
    pattern: /template\.body/,
    recommendation: "Render through resolveAndRenderWhatsAppTemplate() so variables, buttons, media, and versions stay consistent.",
    allow: /(app\/admin\/whatsapp\/templates\/page\.tsx|lib\/whatsapp\/templates\.ts)$/,
  },
]

function walk(dir: string, files: string[] = []) {
  if (!fs.existsSync(dir)) return files
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, files)
    else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) files.push(full)
  }
  return files
}

export function scanWhatsAppMigration(root = process.cwd()): WhatsAppMigrationFinding[] {
  const findings: WhatsAppMigrationFinding[] = []
  const files = ROOT_DIRS.flatMap((dir) => walk(path.join(root, dir)))
  for (const file of files) {
    const relative = path.relative(root, file).replace(/\\/g, "/")
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/)
    for (const [index, line] of lines.entries()) {
      for (const rule of RULES) {
        if (rule.allow?.test(relative)) continue
        const match = line.match(rule.pattern)
        if (!match) continue
        findings.push({
          file: relative,
          line: index + 1,
          rule: rule.rule,
          match: match[0],
          recommendation: rule.recommendation,
        })
      }
    }
  }
  return findings
}
