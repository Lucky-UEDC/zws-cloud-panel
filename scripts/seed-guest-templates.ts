/**
 * Seed the guest automation OS templates into the database.
 *
 * Guest automation is *configuration*, not code: these profiles are rows so an
 * admin can add a new OS without a deploy. The rows below are only the shipped
 * defaults.
 *
 * Idempotency matters more than completeness here, because these rows are edited
 * in production:
 *  - default run: create what is missing, never touch what already exists.
 *    An admin who tuned a template must not have it reverted by a re-run.
 *  - `--force`: re-apply the shipped defaults to the seeded slugs only, and
 *    bump the template version so `appliedTemplateVersion` can tell which
 *    deployments still run the older command set.
 *  - `--verify`: report what would be written and exit non-zero on any template
 *    that fails validation.
 *
 * Nothing here talks to Proxmox. Verification of a template against a real
 * guest is the admin "Test on VM" action, which needs a live VM.
 */

import "dotenv/config"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db"
import { DEFAULT_GUEST_TEMPLATES, type SeedOperation, type SeedTemplate } from "@/lib/guest-automation/default-templates"
import { validateTemplateDraft } from "@/lib/guest-automation/validation"
import { GUEST_OPERATIONS } from "@/lib/guest-automation/constants"

const args = new Set(process.argv.slice(2))
const force = args.has("--force")
const verifyOnly = args.has("--verify")

type SeedReport = {
  slug: string
  action: "created" | "unchanged" | "updated" | "invalid"
  version?: number
  operations?: number
  errors?: string[]
}

function validateSeed(template: SeedTemplate): string[] {
  const result = validateTemplateDraft({
    name: template.name,
    slug: template.slug,
    family: template.family,
    engine: template.engine,
    osIds: template.osIds,
    versionPattern: template.versionPattern ?? null,
    enabled: template.enabled ?? true,
    guestAgentRequired: true,
    priority: template.priority,
    description: template.description ?? null,
    operations: template.operations as unknown as Parameters<typeof validateTemplateDraft>[0]["operations"],
  })
  return result.errors.map((error) => `${error.path}: ${error.message}`)
}

function operationPayload(template: SeedTemplate, operation: SeedOperation) {
  const commandType = operation.commandType ?? "guest-exec"
  return {
    operation: operation.operation,
    enabled: operation.enabled ?? true,
    commandType,
    // A native verb is not run by a shell, so the stored shell is only
    // meaningful for guest-exec; it is defaulted from the template engine.
    shell: operation.shell ?? (template.engine === "windows" ? "windows-powershell" : "linux-sh"),
    command: operation.command,
    arguments: [] as Prisma.InputJsonValue,
    timeoutSeconds: operation.timeoutSeconds,
    requiresRunning: operation.requiresRunning ?? commandType === "guest-native",
    requiresStopped: operation.requiresStopped ?? false,
    requiresGuestAgent: operation.requiresGuestAgent ?? true,
    rebootRequired: operation.rebootRequired ?? false,
    dangerLevel: operation.dangerLevel ?? "safe",
    requiresConfirmation: operation.requiresConfirmation ?? false,
    supportsRollback: operation.supportsRollback ?? false,
    verificationRequired: operation.verificationRequired ?? true,
    verificationCommand: operation.verificationCommand ?? null,
    verificationParser: operation.verificationParser ?? null,
    successCondition: operation.successCondition ?? null,
    rollbackCommand: operation.rollbackCommand ?? null,
    rollbackArguments: (operation.rollbackCommand ? [] : Prisma.JsonNull) as Prisma.InputJsonValue | typeof Prisma.JsonNull,
    fallbacks: (operation.fallbacks ?? []) as Prisma.InputJsonValue,
    stateKey: operation.stateKey ?? null,
    notes: operation.notes ?? null,
  }
}

/**
 * Only the operations this seed actually defines are replaced. An operation an
 * admin added for another purpose is left alone even under `--force`.
 */
function seedOperationNames(template: SeedTemplate): Set<string> {
  return new Set(template.operations.map((operation) => operation.operation))
}

async function seedOne(template: SeedTemplate): Promise<SeedReport> {
  const errors = validateSeed(template)
  if (errors.length) return { slug: template.slug, action: "invalid", errors }

  const existing = await prisma.guestOSTemplate.findUnique({
    where: { slug: template.slug },
    include: { operations: { select: { id: true, operation: true } } },
  })

  if (existing && !force) {
    const known = new Set(existing.operations.map((operation) => operation.operation))
    const missing = [...seedOperationNames(template)].filter((name) => !known.has(name))
    if (!missing.length) {
      return { slug: template.slug, action: "unchanged", version: existing.version, operations: existing.operations.length }
    }
    // The row exists but is missing operations the seed knows about (an older
    // seed, or a partially imported template). Fill the gap without disturbing
    // what is already there.
    await prisma.$transaction(
      missing.map((name) => {
        const operation = template.operations.find((candidate) => candidate.operation === name)!
        return prisma.guestOperationTemplate.create({ data: { ...operationPayload(template, operation), templateId: existing.id } })
      }),
    )
    return { slug: template.slug, action: "updated", version: existing.version, operations: existing.operations.length + missing.length }
  }

  const version = existing ? existing.version + 1 : 1
  const templateRow = await prisma.guestOSTemplate.upsert({
    where: { slug: template.slug },
    create: {
      name: template.name,
      slug: template.slug,
      family: template.family,
      osIds: template.osIds,
      versionPattern: template.versionPattern ?? null,
      enabled: template.enabled ?? true,
      guestAgentRequired: true,
      engine: template.engine,
      priority: template.priority,
      description: template.description ?? null,
      version,
    },
    update: {
      name: template.name,
      family: template.family,
      osIds: template.osIds,
      versionPattern: template.versionPattern ?? null,
      enabled: template.enabled ?? true,
      guestAgentRequired: true,
      engine: template.engine,
      priority: template.priority,
      description: template.description ?? null,
      version,
    },
  })

  const owned = seedOperationNames(template)
  await prisma.guestOperationTemplate.deleteMany({
    where: { templateId: templateRow.id, operation: { in: [...owned] } },
  })
  for (const operation of template.operations) {
    await prisma.guestOperationTemplate.create({ data: { ...operationPayload(template, operation), templateId: templateRow.id } })
  }

  return {
    slug: template.slug,
    action: existing ? "updated" : "created",
    version,
    operations: template.operations.length,
  }
}

async function main() {
  const report: SeedReport[] = []
  for (const template of DEFAULT_GUEST_TEMPLATES) {
    if (verifyOnly) {
      const errors = validateSeed(template)
      report.push({ slug: template.slug, action: errors.length ? "invalid" : "unchanged", errors, operations: template.operations.length })
      continue
    }
    report.push(await seedOne(template))
  }

  const counts = report.reduce<Record<string, number>>((acc, item) => {
    acc[item.action] = (acc[item.action] ?? 0) + 1
    return acc
  }, {})

  for (const item of report) {
    const detail = [
      item.action.padEnd(9),
      `v${String(item.version ?? "-").padEnd(3)}`,
      `${String(item.operations ?? 0).padStart(2)} ops`,
      item.slug,
    ].join("  ")
    if (item.action === "invalid") {
      console.error(`[seed-guest-templates] FAIL ${detail}`)
      for (const error of item.errors ?? []) console.error(`    ${error}`)
    } else {
      console.info(`[seed-guest-templates] ${detail}`)
    }
  }

  const invalid = report.filter((item) => item.action === "invalid")
  console.info(
    `[seed-guest-templates] ${DEFAULT_GUEST_TEMPLATES.length} shipped templates, ${GUEST_OPERATIONS.length} supported operations, result: ${JSON.stringify(counts)}`,
  )

  if (invalid.length) {
    console.error(`[seed-guest-templates] ${invalid.length} template(s) failed validation and were NOT written.`)
    process.exitCode = 1
  }
}

main()
  .catch((error) => {
    console.error("[seed-guest-templates] failed:", error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
