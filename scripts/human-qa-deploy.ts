/**
 * ZWS Cloud Human QA Deployment Script
 *
 * Creates disposable QA VMs from ALL enabled OS templates,
 * boots them, waits for guest agent readiness (max 10 min),
 * records status in VM notes, and leaves them running
 * for manual IP/password testing from the client panel.
 *
 * Usage:
 *   npx tsx scripts/human-qa-deploy.ts
 *
 * DO NOT run with --cleanup or --auto-test.
 * This is a HUMAN QA test - manual verification follows.
 */

import "dotenv/config"
import { prisma } from "@/lib/db"
import { createProxmoxClient } from "@/lib/proxmox"
import { decryptSecretValue, isEncryptedSecret } from "@/lib/secret-crypto"
import { listGuestTemplates } from "@/lib/guest-automation/admin-templates"
import { guestContextFor } from "@/lib/guest-automation/first-boot"
import { GuestAutomationService } from "@/lib/guest-automation/service"

interface EnabledTemplate {
  catalogue: {
    id: string
    name: string
    proxmoxVmid: number
    osFamily: string | null
    osVersion: string | null
  }
  profile: {
    slug: string
    family: string
    engine: string
    version: number
  } | null
  engine: "linux" | "windows"
}

interface QAVM {
  templateName: string
  templateVmid: number
  osFamily: string
  osVersion: string | null
  profileSlug: string | null
  engine: "linux" | "windows"
  qaVmid: number
  qaName: string
  nodeName: string
  status: "CREATING" | "BOOTING" | "WAITING_FOR_GUEST_AGENT" | "GUEST_AGENT_READY" | "READY_FOR_HUMAN_TEST" | "TIMEOUT" | "FAILED"
  bootStartTime: number
  bootEndTime?: number
  guestAgentReadyTime?: number
  error?: string
  consoleAvailable: boolean
  consoleError?: string
}

const node = await prisma.proxmoxNode.findFirst()
if (!node) {
  console.error("No compute node configured")
  process.exit(1)
}
if (!node.tokenSecret || !node.tokenId || !node.host || !node.nodeName) {
  console.error("Compute node has incomplete credentials")
  process.exit(1)
}
const tokenSecret = isEncryptedSecret(node.tokenSecret) ? decryptSecretValue(node.tokenSecret) : node.tokenSecret
const client = createProxmoxClient(node.host, node.tokenId, tokenSecret, {
  allowInsecureTls: node.allowInsecureTls,
  timeoutMs: 60_000,
})
const nodeName = node.nodeName

const MAX_BOOT_MS = 10 * 60 * 1000
const POLL_INTERVAL_MS = 5_000

async function main() {
  const nd = node!
  console.log("=== ZWS CLOUD HUMAN QA DEPLOYMENT ===")
  console.log(`Node: ${nd.name} (${nd.nodeName})`)
  console.log(`Time: ${new Date().toISOString()}`)
  console.log("")

  // 1. Get ALL enabled templates from the ZWS catalogue
  const enabledTemplates = await getEnabledTemplates()
  console.log(`Found ${enabledTemplates.length} enabled template(s):`)
  for (const t of enabledTemplates) {
    console.log(`  - ${t.catalogue.name} (VMID ${t.catalogue.proxmoxVmid}) -> ${t.profile?.slug || "NO PROFILE"} [${t.engine}]`)
  }
  console.log("")

  // 2. Create disposable QA VMs
  const qaVMs: QAVM[] = []
  for (const tmpl of enabledTemplates) {
    const qa = await createAndBootQAVM(tmpl)
    qaVMs.push(qa)
  }

  // 3. Wait for all VMs to reach GUEST_AGENT_READY or TIMEOUT
  console.log("\n=== WAITING FOR GUEST AGENTS (max 10 min) ===")
  const waitResults = await waitForGuestAgents(qaVMs)

  // 4. Check console availability
  console.log("\n=== CHECKING CONSOLE AVAILABILITY ===")
  for (const qa of qaVMs) {
    if (qa.status === "GUEST_AGENT_READY" || qa.status === "READY_FOR_HUMAN_TEST") {
      await checkConsole(qa)
    }
  }

  // 5. Record VM notes
  console.log("\n=== WRITING VM NOTES ===")
  for (const qa of qaVMs) {
    await writeVMNotes(qa)
  }

  // 6. Print final summary table
  printSummaryTable(qaVMs)

  // 7. Save QA VM IDs for later cleanup reference
  console.log("\n=== QA VM IDs CREATED ===")
  for (const qa of qaVMs) {
    console.log(`${qa.qaVmid} (${qa.qaName}) - ${qa.status}`)
  }
  console.log("\nIMPORTANT: VMs are LEFT RUNNING for human testing.")
  console.log("Do NOT run cleanup until manual verification is complete.")
}

async function getEnabledTemplates(): Promise<EnabledTemplate[]> {
  // Get all OS templates from catalogue that are active and have a proxmoxVmid
  const catalogue = await prisma.osTemplate.findMany({
    where: {
      source: "PROXMOX",
      proxmoxVmid: { not: null },
      isActive: true,
    },
    orderBy: [{ osFamily: "asc" }, { osVersion: "asc" }],
  })

  // Get guest profiles to match
  const profiles = await listGuestTemplates()

  const results: EnabledTemplate[] = []
  for (const cat of catalogue) {
    const matchingProfile = profiles.find(p => p.enabled && p.osTemplateId === cat.id)
    results.push({
      catalogue: {
        id: cat.id,
        name: cat.name,
        proxmoxVmid: cat.proxmoxVmid!,
        osFamily: cat.osFamily,
        osVersion: cat.osVersion,
      },
      profile: matchingProfile ? {
        slug: matchingProfile.slug,
        family: matchingProfile.family,
        engine: matchingProfile.engine,
        version: matchingProfile.version,
      } : null,
      engine: (matchingProfile?.engine as "linux" | "windows") || "linux",
    })
  }
  return results
}

async function createAndBootQAVM(tmpl: EnabledTemplate): Promise<QAVM> {
  const templateVmid = tmpl.catalogue.proxmoxVmid
  const random = Math.random().toString(36).substring(2, 6)
  const safeFamily = (tmpl.catalogue.osFamily || tmpl.profile?.family || "unknown").toLowerCase().replace(/[^a-z0-9]/g, "-")
  const safeVersion = (tmpl.catalogue.osVersion || "").toLowerCase().replace(/[^a-z0-9]/g, "-")
  const qaName = `zws-qa-human-${safeFamily}-${safeVersion}-${random}`.slice(0, 50)

  console.log(`\n--- Creating QA VM from ${tmpl.catalogue.name} (VMID ${templateVmid}) ---`)

  const qa: QAVM = {
    templateName: tmpl.catalogue.name,
    templateVmid,
    osFamily: tmpl.catalogue.osFamily || "unknown",
    osVersion: tmpl.catalogue.osVersion,
    profileSlug: tmpl.profile?.slug || null,
    engine: (tmpl.profile?.engine as "linux" | "windows") || "linux",
    qaVmid: 0,
    qaName,
    nodeName,
    status: "CREATING",
    bootStartTime: Date.now(),
    consoleAvailable: false,
  }

  try {
    // Clone template
    const nextVmid = await client.getNextVmid()
    qa.qaVmid = nextVmid

    console.log(`  Cloning to VMID ${nextVmid}...`)
    const upid = await client.cloneVM(nodeName, templateVmid, nextVmid, qaName, { full: 1, target: nodeName })
    await client.waitForTask(nodeName, upid, 300_000)

    // Add QA tag and disable Cloud-Init inputs
    const cfg = await client.getVMConfig(nodeName, nextVmid)
    const updates: Record<string, any> = {
      tags: "qa-human-test",
      ipconfig0: "",
      ciuser: "",
      cipassword: "",
      nameserver: "",
      searchdomain: "",
    }

    // Ensure agent channel is open on the clone
    const agentFlag = Object.entries(cfg).find(([k]) => /^agent(\d+)?$/i.test(k))
    if (!agentFlag || Number(agentFlag[1]) !== 1) {
      updates.agent = "1"
    }

    await client.updateVMConfig(nodeName, nextVmid, updates)

    // Start VM
    console.log(`  Starting VMID ${nextVmid}...`)
    qa.status = "BOOTING"
    await client.startVMWithStatus(nodeName, nextVmid)

    qa.status = "WAITING_FOR_GUEST_AGENT"
    console.log(`  VM started, waiting for guest agent...`)

    return qa
  } catch (e: any) {
    qa.status = "FAILED"
    qa.error = e?.message?.slice(0, 200) || String(e)
    console.error(`  FAILED: ${qa.error}`)
    return qa
  }
}

async function waitForGuestAgents(qavms: QAVM[]) {
  const deadline = Date.now() + MAX_BOOT_MS
  const pending = qavms.filter(q => q.status === "WAITING_FOR_GUEST_AGENT")

  while (Date.now() < deadline && pending.length > 0) {
    for (const qa of pending) {
      try {
        await client.requestWithStatus(`/nodes/${encodeURIComponent(nodeName)}/qemu/${qa.qaVmid}/agent/ping`, "POST")
        qa.status = "GUEST_AGENT_READY"
        qa.guestAgentReadyTime = Date.now()
        console.log(`  ✅ VMID ${qa.qaVmid} (${qa.qaName}) - Guest agent READY after ${Math.round((qa.guestAgentReadyTime - qa.bootStartTime) / 1000)}s`)
      } catch {
        // Still waiting
      }
    }
    pending.length = 0
    for (const qa of qavms) {
      if (qa.status === "WAITING_FOR_GUEST_AGENT") pending.push(qa)
    }
    if (pending.length > 0) await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))
  }

  // Mark timeouts
  for (const qa of qavms) {
    if (qa.status === "WAITING_FOR_GUEST_AGENT") {
      qa.status = "TIMEOUT"
      qa.error = `Guest agent not ready after ${MAX_BOOT_MS / 1000}s`
      console.log(`  ⏱ VMID ${qa.qaVmid} (${qa.qaName}) - TIMEOUT`)
    } else if (qa.status === "GUEST_AGENT_READY") {
      qa.status = "READY_FOR_HUMAN_TEST"
    }
  }
}

async function checkConsole(qa: QAVM) {
  try {
    await client.getVNCTicket(nodeName, qa.qaVmid)
    qa.consoleAvailable = true
    console.log(`  🖥 VMID ${qa.qaVmid} - Console AVAILABLE (VNC)`)
  } catch (e: any) {
    qa.consoleAvailable = false
    qa.consoleError = e?.message?.slice(0, 200)
    console.log(`  ❌ VMID ${qa.qaVmid} - Console FAILED: ${qa.consoleError}`)
  }
}

async function writeVMNotes(qa: QAVM) {
  const now = new Date().toISOString()
  const bootTimeSec = qa.bootEndTime ? Math.round((qa.bootEndTime - qa.bootStartTime) / 1000)
    : qa.guestAgentReadyTime ? Math.round((qa.guestAgentReadyTime - qa.bootStartTime) / 1000)
    : "N/A"

  const note = `
--- ZWS CLOUD HUMAN QA TEST ---
Deployment: ${qa.status === "FAILED" ? "FAIL" : "PASS"}
Boot: ${qa.status === "TIMEOUT" || qa.status === "FAILED" ? "FAIL" : "PASS"}
Guest Agent: ${qa.status === "GUEST_AGENT_READY" || qa.status === "READY_FOR_HUMAN_TEST" ? "PASS" : "FAIL"}
OS Detection: PENDING
Console: ${qa.consoleAvailable ? "PASS" : "FAIL"}
Disk Detection: PENDING

Manual verification:
IP: PENDING
Gateway: PENDING
DNS: PENDING
Password: PENDING

Cloud-Init: NOT USED

Template: ${qa.templateName}
Template VMID: ${qa.templateVmid}
OS: ${qa.osFamily} ${qa.osVersion || ""}
Profile: ${qa.profileSlug || "NONE"}
Engine: ${qa.engine}
QA VMID: ${qa.qaVmid}
QA Name: ${qa.qaName}
Created: ${now}
Boot time: ${bootTimeSec}s
Max readiness wait: 600s
Test purpose: Human verification of ZWS Cloud OS-specific guest automation
--- END ZWS CLOUD HUMAN QA TEST ---
`

  try {
    await client.updateVMConfig(nodeName, qa.qaVmid, { description: note.trim() })
    console.log(`  📝 VMID ${qa.qaVmid} - Notes written`)
  } catch (e: any) {
    console.log(`  ⚠️ VMID ${qa.qaVmid} - Notes failed: ${e?.message?.slice(0, 100)}`)
  }
}

function printSummaryTable(qavms: QAVM[]) {
  console.log("\n=== FINAL HUMAN QA SUMMARY ===")
  console.log("+----------------+--------+-------+---------+-----------+---------+")
  console.log("| OS             | QA VM  | Node  | Agent   | Console   | Status  |")
  console.log("+----------------+--------+-------+---------+-----------+---------+")

  for (const qa of qavms) {
    const osLabel = `${qa.osFamily} ${qa.osVersion || ""}`.slice(0, 16).padEnd(16)
    const vmLabel = String(qa.qaVmid).padEnd(6)
    const agentLabel = (qa.status === "GUEST_AGENT_READY" || qa.status === "READY_FOR_HUMAN_TEST" ? "READY" : qa.status === "TIMEOUT" ? "TIMEOUT" : qa.status === "FAILED" ? "FAILED" : "WAITING").padEnd(7)
    const consoleLabel = (qa.consoleAvailable ? "VNC OK" : "FAILED").padEnd(9)
    const statusLabel = qa.status === "READY_FOR_HUMAN_TEST" ? "READY" : qa.status.padEnd(7)
    console.log(`| ${osLabel} | ${vmLabel} | m2-v2 | ${agentLabel} | ${consoleLabel} | ${statusLabel} |`)
  }

  console.log("+----------------+--------+-------+---------+-----------+---------+")

  const total = qavms.length
  const deployed = qavms.filter(q => q.status !== "FAILED" || q.qaVmid > 0).length
  const booted = qavms.filter(q => q.status !== "CREATING" && q.status !== "FAILED").length
  const ready = qavms.filter(q => q.status === "READY_FOR_HUMAN_TEST").length
  const failed = qavms.filter(q => q.status === "FAILED").length
  const timeout = qavms.filter(q => q.status === "TIMEOUT").length
  const skipped = qavms.filter(q => q.profileSlug === null).length

  console.log(`\nTOTAL TEMPLATES: ${total}`)
  console.log(`DEPLOYED: ${deployed}`)
  console.log(`BOOTED: ${booted}`)
  console.log(`READY FOR HUMAN TEST: ${ready}`)
  console.log(`FAILED: ${failed}`)
  console.log(`TIMEOUT: ${timeout}`)
  console.log(`SKIPPED (no profile): ${skipped}`)

  console.log("\nQA VM IDs:")
  for (const qa of qavms) {
    console.log(`  ${qa.qaVmid} - ${qa.qaName} - ${qa.status}`)
  }

  console.log("\n⏳ WAITING FOR HUMAN VERIFICATION...")
  console.log("Test IP, Gateway, DNS, Password from client panel.")
  console.log("DO NOT run cleanup until manual testing is complete.")
}

main()
  .catch(e => { console.error("FATAL:", e); process.exit(1) })
  .finally(async () => { await prisma.$disconnect() })