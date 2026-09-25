#!/usr/bin/env node

import { PrismaClient } from "@prisma/client"
import { assertDatabaseUrl } from "../lib/db-url"

assertDatabaseUrl()

const prisma = new PrismaClient()
const TARGET_SLUGS = ["zp2-large", "zp2-medium"]

async function main() {
  const products = await prisma.product.findMany({
    where: { slug: { in: TARGET_SLUGS }, deletedAt: null },
    select: { id: true, slug: true },
  })
  const found = new Set(products.map((product) => product.slug))
  const missing = TARGET_SLUGS.filter((slug) => !found.has(slug))

  if (missing.length) {
    console.log(`DEVIL700 not seeded. Missing product slug(s): ${missing.join(", ")}`)
    return
  }

  const coupon = await prisma.coupon.upsert({
    where: { code: "DEVIL700" },
    create: {
      code: "DEVIL700",
      description: "Fixed INR 700 discount for ZP2 Large and ZP2 Medium.",
      discountType: "FIXED",
      discountValue: 700,
      active: true,
      applicableProducts: TARGET_SLUGS,
      applicableProductGroups: [],
      applicableBillingTerms: [],
      duration: "FIRST_INVOICE_ONLY",
    },
    update: {
      description: "Fixed INR 700 discount for ZP2 Large and ZP2 Medium.",
      discountType: "FIXED",
      discountValue: 700,
      active: true,
      applicableProducts: TARGET_SLUGS,
      applicableProductGroups: [],
      applicableBillingTerms: [],
      duration: "FIRST_INVOICE_ONLY",
      durationCycles: null,
    },
  })

  console.log(`DEVIL700 ready for: ${TARGET_SLUGS.join(", ")} (${coupon.id})`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
