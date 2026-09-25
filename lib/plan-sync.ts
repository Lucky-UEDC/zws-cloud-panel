import { prisma } from "@/lib/db"
import { Prisma } from "@prisma/client"
import { DEDICATED_SEED, VPS_FIXED_SEED, type SeedProduct } from "@/lib/data/catalog-seed"

type SyncTrigger = "auto" | "manual" | "test"

export type PlanSyncResult = {
  synced: number
  updated: number
  newPlans: number
  skipped: boolean
  reason?: string
  source: string
}

const AUTO_SYNC_COOLDOWN_MS = 45_000

async function assertPlanSyncTable() {
  try {
    await prisma.planSyncRun.findFirst({ select: { id: true } })
  } catch (error) {
    console.error("[plan-sync] plan_sync_runs table check failed", error)
    throw new Error("plan_sync_runs table missing or inaccessible. Run Prisma migrations before syncing plans.")
  }
}

async function ensureRootCategory(slug: string, title: string, description: string) {
  return prisma.catalogCategory.upsert({
    where: { slug },
    create: {
      slug,
      title,
      description,
      showInNav: true,
      isActive: true,
      visibility: "public",
      showLandingPage: true,
      sortOrder: slug === "vps" ? 10 : slug === "dedicated" ? 20 : 30,
    },
    update: {
      title,
      description,
      isActive: true,
      visibility: "public",
      showInNav: true,
    },
  })
}

function monthlyToTerm(monthly: number, discount: number) {
  return Math.round(monthly * (1 - discount) * 100) / 100
}

function buildSeedProducts(): SeedProduct[] {
  return [
    ...VPS_FIXED_SEED,
    ...DEDICATED_SEED,
    {
      slug: "custom-configurator",
      name: "Custom Cloud Instance",
      family: "configurable",
      categorySlug: "vps",
      description: "Build a custom cloud instance with flexible CPU, RAM, storage, region, and billing options.",
      shortDescription: "Build a custom cloud instance",
      cpuCores: 4,
      ramGb: 8,
      storageGb: 160,
      storageType: "nvme",
      bandwidthTb: 2,
      price1m: 1200,
      ctaLabel: "Build Custom Instance",
      ctaMode: "configure",
      features: ["Custom CPU/RAM/Storage", "OS choices", "Region choices", "Flexible billing terms"],
      sortOrder: 5,
    },
  ]
}

function needsUpdate(existing: { [key: string]: unknown }, product: SeedProduct, categoryId: string) {
  const metadata = existing.metadata && typeof existing.metadata === "object" && !Array.isArray(existing.metadata) ? existing.metadata as Record<string, unknown> : {}
  return metadata.seededFrom == null || metadata.seedCatalogSlug !== product.slug || metadata.seedCategoryId !== categoryId
}

function buildSafeExistingProductUpdate(
  existing: Record<string, unknown>,
  seed: SeedProduct,
  categoryId: string,
  source: string,
): Prisma.ProductUncheckedUpdateInput {
  const existingMetadata = existing.metadata && typeof existing.metadata === "object" && !Array.isArray(existing.metadata) ? existing.metadata : {}
  return {
    metadata: {
      ...existingMetadata,
      seededFrom: source,
      seedCatalogSlug: seed.slug,
      seedCategoryId: categoryId,
      lastSyncedAt: new Date().toISOString(),
    },
  }
}

export async function syncPlans(options?: { trigger?: SyncTrigger; triggeredBy?: string }) {
  const trigger = options?.trigger || "manual"
  const source = "catalog_seed_v2"

  await assertPlanSyncTable()

  const run = await prisma.planSyncRun.create({
    data: {
      triggerType: trigger,
      triggeredBy: options?.triggeredBy || null,
      source,
      summary: {},
    },
  })

  try {
    if (trigger === "auto") {
      const recent = await prisma.planSyncRun.findFirst({
        where: {
          triggerType: "auto",
          completedAt: { not: null },
          startedAt: { gt: new Date(Date.now() - AUTO_SYNC_COOLDOWN_MS) },
        },
        orderBy: { startedAt: "desc" },
      })
      if (recent) {
        const result: PlanSyncResult = {
          synced: 0,
          updated: 0,
          newPlans: 0,
          skipped: true,
          reason: "recent_auto_sync",
          source,
        }
        await prisma.planSyncRun.update({ where: { id: run.id }, data: { skipped: true, summary: result, completedAt: new Date() } })
        return result
      }
    }

    const vpsCategory = await ensureRootCategory("vps", "VPS", "Fixed VPS plans for fast, reliable cloud workloads.")
    const dedicatedCategory = await ensureRootCategory("dedicated", "Dedicated", "Bare metal dedicated server plans for high-performance hosting.")
    const configureCategory = await ensureRootCategory("configure", "Configure", "Build your own server with custom CPU, RAM, storage, and region.")

    const seedProducts = buildSeedProducts()
    const existing = await prisma.product.findMany({ where: { slug: { in: seedProducts.map((p) => p.slug) } } })
    const existingBySlug = new Map(existing.map((item) => [item.slug.toLowerCase(), item]))

    let updated = 0
    let newPlans = 0

    for (const seed of seedProducts) {
      const existingRow = existingBySlug.get(seed.slug.toLowerCase())
      const categoryId = seed.categorySlug === "vps" ? vpsCategory.id : dedicatedCategory.id
      const billingTerms = seed.family === "fixed_vps" ? [1, 3, 6, 12, 24, 36] : [1]

      const data: Prisma.ProductUncheckedCreateInput = {
        slug: seed.slug,
        name: seed.name,
        description: seed.description,
        shortDescription: seed.shortDescription || seed.description,
        category: seed.categorySlug,
        categoryId,
        type: seed.family,
        ctaMode: seed.ctaMode,
        ctaLabel: seed.ctaLabel,
        badges: seed.badges || [],
        seoTitle: seed.name,
        seoDescription: seed.description,
        seoKeywords: seed.family === "dedicated" ? ["dedicated server", "bare metal", seed.name] : ["vps", "cloud hosting", seed.name],
        whatsappEnabled: Boolean(seed.whatsappEnabled),
        visibility: "public",
        status: "active",
        isActive: true,
        cpuCores: seed.cpuCores,
        ramGb: seed.ramGb,
        storageGb: seed.storageGb,
        storageType: seed.storageType,
        bandwidthTb: seed.bandwidthTb,
        price1m: seed.price1m,
        price3m: seed.family === "fixed_vps" ? monthlyToTerm(seed.price1m, 0.05) : null,
        price6m: seed.family === "fixed_vps" ? monthlyToTerm(seed.price1m, 0.1) : null,
        price12m: seed.family === "fixed_vps" ? monthlyToTerm(seed.price1m, 0.15) : null,
        price24m: seed.family === "fixed_vps" ? monthlyToTerm(seed.price1m, 0.2) : null,
        price36m: seed.family === "fixed_vps" ? monthlyToTerm(seed.price1m, 0.25) : null,
        priceHourly: seed.priceHourly || null,
        isFeatured: (seed.badges || []).some((badge) => badge.toLowerCase().includes("popular")),
        sortOrder: seed.sortOrder,
        billingTerms,
        regions: seed.family === "dedicated" ? ["India"] : [],
        specs: {},
        optionGroups: [],
        serviceAttributes: {},
        features: seed.features,
        disks: [{ type: seed.storageType, sizeGb: seed.storageGb, label: "Disk 1" }],
        metadata: { seededFrom: source, seededAt: new Date().toISOString() },
      }

      if (!existingRow) {
        await prisma.product.create({ data })
        newPlans += 1
      } else {
        const safeUpdate = buildSafeExistingProductUpdate(existingRow as unknown as Record<string, unknown>, seed, categoryId, source)
        console.log("SYNC PLAN PRESERVED MANUAL FIELDS", {
          slug: seed.slug,
          preserved: [
            "price1m",
            "price3m",
            "price6m",
            "price12m",
            "price24m",
            "price36m",
            "priceHourly",
            "cpuCores",
            "ramGb",
            "storageGb",
            "storageType",
            "bandwidthTb",
            "storagePolicyType",
            "requiredStorageType",
            "requiredStoragePoolId",
            "defaultStoragePoolId",
            "storagePoolPolicy",
            "allowStorageFallback",
            "premiumIpEnabled",
            "disks",
            "nodeClassId",
            "defaultCpuSockets",
            "defaultCoresPerSocket",
            "billingTerms",
            "regions",
            "specs",
            "optionGroups",
            "serviceAttributes",
          ],
          updated: Object.keys(safeUpdate),
        })
        if (needsUpdate(existingRow as unknown as Record<string, unknown>, seed, categoryId)) {
          updated += 1
        }
        await prisma.product.update({
          where: { id: existingRow.id },
          data: safeUpdate,
        })
      }
    }

    const result: PlanSyncResult = {
      synced: seedProducts.length,
      updated,
      newPlans,
      skipped: false,
      source,
    }

    await prisma.planSyncRun.update({
      where: { id: run.id },
      data: {
        synced: result.synced,
        updated: result.updated,
        newPlans: result.newPlans,
        skipped: false,
        summary: result,
        completedAt: new Date(),
      },
    })

    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown sync error"
    await prisma.planSyncRun.update({ where: { id: run.id }, data: { error: message, completedAt: new Date() } })
    throw error
  }
}
