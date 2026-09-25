import "dotenv/config"
import { pathToFileURL } from "node:url"
import { prisma } from "@/lib/db"

const DEMO_PLAN = {
  name: "Demo Backup",
  slug: "backup-demo",
  description: "Demo backup plan: 10 automatic backups, 100 GB quota, and 1 GB extra storage pricing.",
  price: 199,
  currency: "INR",
  billingCycle: "monthly",
  taxPercent: 18,
  maxBackups: 10,
  storageQuotaGb: 100,
  manualBackupEnabled: true,
  automaticBackupEnabled: true,
  scheduleOptions: [180, 360, 720, 1440],
  retentionCount: 10,
  restoreEnabled: true,
  downloadEnabled: true,
  overageEnabled: true,
  overagePricePerGb: 1,
  extraStoragePricePerGb: 1,
  gracePeriodDays: 7,
  maxStorageCapGb: null,
  featured: true,
  active: true,
  archived: false,
}

export async function seedBillingBaseline(opts?: { dryRun?: boolean }) {
  const dryRun = Boolean(opts?.dryRun)
  console.info(`[seed-billing-baseline] ensuring Demo Backup plan${dryRun ? " (dry-run)" : ""}`)
  const existing = await prisma.backupPlan.findUnique({ where: { slug: DEMO_PLAN.slug } }).catch(() => null)
  if (existing) {
    if (dryRun) {
      console.info("[seed-billing-baseline] [dry-run] would update", { id: existing.id, slug: DEMO_PLAN.slug })
      return
    }
    await prisma.backupPlan.update({
      where: { id: existing.id },
      data: {
        name: DEMO_PLAN.name,
        description: DEMO_PLAN.description,
        price: DEMO_PLAN.price,
        currency: DEMO_PLAN.currency,
        billingCycle: DEMO_PLAN.billingCycle,
        taxPercent: DEMO_PLAN.taxPercent,
        maxBackups: DEMO_PLAN.maxBackups,
        storageQuotaGb: DEMO_PLAN.storageQuotaGb,
        manualBackupEnabled: DEMO_PLAN.manualBackupEnabled,
        automaticBackupEnabled: DEMO_PLAN.automaticBackupEnabled,
        scheduleOptions: DEMO_PLAN.scheduleOptions,
        retentionCount: DEMO_PLAN.retentionCount,
        restoreEnabled: DEMO_PLAN.restoreEnabled,
        downloadEnabled: DEMO_PLAN.downloadEnabled,
        overageEnabled: DEMO_PLAN.overageEnabled,
        overagePricePerGb: DEMO_PLAN.overagePricePerGb,
        extraStoragePricePerGb: DEMO_PLAN.extraStoragePricePerGb,
        gracePeriodDays: DEMO_PLAN.gracePeriodDays,
        maxStorageCapGb: null,
        featured: true,
        active: true,
        archived: false,
      },
    })
    console.info("[seed-billing-baseline] Demo Backup plan updated", { id: existing.id })
    return
  }
  if (dryRun) {
    console.info("[seed-billing-baseline] [dry-run] would create", { slug: DEMO_PLAN.slug, price: DEMO_PLAN.price })
    return
  }
  await prisma.backupPlan.create({
    data: {
      name: DEMO_PLAN.name,
      slug: DEMO_PLAN.slug,
      description: DEMO_PLAN.description,
      price: DEMO_PLAN.price,
      currency: DEMO_PLAN.currency,
      billingCycle: DEMO_PLAN.billingCycle,
      taxPercent: DEMO_PLAN.taxPercent,
      maxBackups: DEMO_PLAN.maxBackups,
      storageQuotaGb: DEMO_PLAN.storageQuotaGb,
      manualBackupEnabled: DEMO_PLAN.manualBackupEnabled,
      automaticBackupEnabled: DEMO_PLAN.automaticBackupEnabled,
      scheduleOptions: DEMO_PLAN.scheduleOptions,
      retentionCount: DEMO_PLAN.retentionCount,
      restoreEnabled: DEMO_PLAN.restoreEnabled,
      downloadEnabled: DEMO_PLAN.downloadEnabled,
      overageEnabled: DEMO_PLAN.overageEnabled,
      overagePricePerGb: DEMO_PLAN.overagePricePerGb,
      extraStoragePricePerGb: DEMO_PLAN.extraStoragePricePerGb,
      gracePeriodDays: DEMO_PLAN.gracePeriodDays,
      maxStorageCapGb: null,
      featured: true,
      active: true,
      archived: false,
    },
  })
  console.info("[seed-billing-baseline] Demo Backup plan created")
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  const dryRun = process.argv.includes("--dry-run")
  seedBillingBaseline({ dryRun })
    .then(async () => {
      await prisma.$disconnect()
      console.info(`[seed-billing-baseline] ${dryRun ? "dry-run complete (no changes made)" : "complete"}`)
    })
    .catch(async (error) => {
      await prisma.$disconnect().catch(() => undefined)
      console.error("[seed-billing-baseline] failed", error)
      process.exit(1)
    })
}