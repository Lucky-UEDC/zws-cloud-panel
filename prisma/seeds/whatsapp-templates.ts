import "dotenv/config"
import { prisma } from "@/lib/db"
import {
  ensureDefaultWhatsAppTemplates,
  invalidateWhatsAppTemplateCache,
  validateWhatsAppRequiredTemplates,
} from "@/lib/whatsapp/templates"

export async function seedWhatsAppTemplates() {
  console.info("[seed:whatsapp-templates] seeding system templates")
  await ensureDefaultWhatsAppTemplates()
  await invalidateWhatsAppTemplateCache()
  const validation = await validateWhatsAppRequiredTemplates()
  if (!validation.ok) {
    const missing = validation.missing.map((row) => `${row.key}:${row.missingReasons.join(",")}`).join(" ")
    throw new Error(`WhatsApp template seed incomplete: ${missing}`)
  }
  console.info("[seed:whatsapp-templates] required templates valid", {
    required: validation.required.length,
    cacheVersion: validation.cache.localVersion,
  })
  return validation
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seedWhatsAppTemplates()
    .then(async () => {
      await prisma.$disconnect()
      process.exit(0)
    })
    .catch(async (error) => {
      console.error("[seed:whatsapp-templates] failed", error)
      await prisma.$disconnect().catch(() => null)
      process.exit(1)
    })
}
