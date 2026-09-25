import "dotenv/config"
import { prisma } from "@/lib/db"
import { syncPlans } from "@/lib/plan-sync"
import { updateRuntimeSecurityPolicy } from "@/lib/security-policy"

const baselineTemplates = [
  {
    id: "baseline-ubuntu-2204",
    name: "Ubuntu 22.04 LTS",
    slug: "ubuntu-22-04",
    osType: "linux",
    category: "ubuntu",
    osFamily: "ubuntu",
    osVersion: "22.04",
    defaultUsername: "root",
    proxmoxVmid: 9001,
    proxmoxTemplateName: "ubuntu-22.04-cloudinit-template",
    cloudInitSupported: true,
    sortOrder: 10,
  },
  {
    id: "baseline-debian-12",
    name: "Debian 12",
    slug: "debian-12",
    osType: "linux",
    category: "debian",
    osFamily: "debian",
    osVersion: "12",
    defaultUsername: "root",
    proxmoxVmid: 9002,
    proxmoxTemplateName: "debian-12-cloudinit-template",
    cloudInitSupported: true,
    sortOrder: 20,
  },
]

async function seedBaseline() {
  console.info("[seed-install-baseline] ensuring safe default security policy")
  await updateRuntimeSecurityPolicy({ mfaMode: "recommend" }, "install.sh")

  console.info("[seed-install-baseline] syncing catalog products")
  const originalLog = console.log
  console.log = (...args: unknown[]) => {
    if (String(args[0] || "").startsWith("SYNC PLAN PRESERVED MANUAL FIELDS")) return
    originalLog(...args)
  }
  try {
    await syncPlans({ trigger: "auto", triggeredBy: "install.sh" })
  } finally {
    console.log = originalLog
  }

  console.info("[seed-install-baseline] ensuring baseline OS templates")
  for (const template of baselineTemplates) {
    await prisma.osTemplate.upsert({
      where: { id: template.id },
      create: {
        ...template,
        isoPath: template.proxmoxTemplateName,
        isActive: true,
        isDefault: template.id === "baseline-ubuntu-2204",
        isRecommended: template.id === "baseline-ubuntu-2204",
        reinstallEnabled: true,
        source: "PROXMOX",
        sourceType: "TEMPLATE_VM",
        sourceVmid: template.proxmoxVmid,
        syncedFromProxmox: true,
        proxmoxStatus: "template",
        storage: "local-lvm",
        proxmoxStorage: "local-lvm",
        proxmoxConfig: { seededBy: "install.sh" },
      },
      update: {
        name: template.name,
        slug: template.slug,
        osType: template.osType,
        category: template.category,
        osFamily: template.osFamily,
        osVersion: template.osVersion,
        defaultUsername: template.defaultUsername,
        isActive: true,
        isDefault: template.id === "baseline-ubuntu-2204",
        isRecommended: template.id === "baseline-ubuntu-2204",
        reinstallEnabled: true,
        source: "PROXMOX",
        sourceType: "TEMPLATE_VM",
        sourceVmid: template.proxmoxVmid,
        syncedFromProxmox: true,
        proxmoxVmid: template.proxmoxVmid,
        proxmoxTemplateName: template.proxmoxTemplateName,
        proxmoxStatus: "template",
        cloudInitSupported: template.cloudInitSupported,
        sortOrder: template.sortOrder,
        storage: "local-lvm",
        proxmoxStorage: "local-lvm",
        proxmoxConfig: { seededBy: "install.sh" },
      },
    })
  }
}

seedBaseline()
  .then(async () => {
    await prisma.$disconnect()
    console.info("[seed-install-baseline] complete")
  })
  .catch(async (error) => {
    await prisma.$disconnect().catch(() => undefined)
    console.error("[seed-install-baseline] failed", error)
    process.exit(1)
  })
