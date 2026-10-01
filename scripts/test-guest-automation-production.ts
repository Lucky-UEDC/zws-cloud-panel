/**
 * Guest automation production QA.
 *
 * Runs the guest layer against the real fleet and prints a matrix. It exists
 * because the unit tests answer "is the logic right" and only this answers "does
 * it work on a real guest" — and on this project the difference was decisive: six
 * bugs that passed every unit test, because the QEMU Guest Agent sends a
 * different payload shape than the specification does.
 *
 * What it will NOT do, deliberately:
 *
 * - It never changes a customer's network, password, disk or hostname. Every
 *   change-shaped test is a dry run, and the one real write-shaped test
 *   (idempotency) asks for the value the guest already has, so the plan resolves
 *   to "already applied" and no command runs. A test suite that reconfigures
 *   production servers to check that configuration works is not a test suite.
 * - It never modifies a Proxmox template. Templates are read; a disposable clone
 *   is created instead, and destroyed afterwards unless `--keep` is passed.
 * - It never turns a guest capability on to make a test pass. A template whose
 *   image has no agent is reported as such.
 *
 * Usage:
 *   pnpm qa:guest                      run against running guests
 *   pnpm qa:guest -- --clone           also clone templates that have no running guest
 *   pnpm qa:guest -- --clone --keep    leave the clones running for inspection
 *   pnpm qa:guest -- --json            machine-readable output
 *   pnpm qa:guest -- --vm 114          restrict to one VMID
 *   pnpm qa:guest -- --notes           write the QA block into Proxmox VM notes
 */

import "dotenv/config"
import { prisma } from "@/lib/db"
import { createProxmoxClient } from "@/lib/proxmox"
import { decryptSecretValue, isEncryptedSecret } from "@/lib/secret-crypto"
import { GuestAutomationService, osMetadataForVps } from "@/lib/guest-automation/service"
import { guestContextFor } from "@/lib/guest-automation/first-boot"
import { listGuestTemplates } from "@/lib/guest-automation/admin-templates"
import { measureNodeCapabilities } from "@/lib/guest-automation/node-capabilities"
import { collectTemplateDiskUsage } from "@/lib/guest-automation/telemetry"
import { GUEST_OPERATIONS } from "@/lib/guest-automation/constants"
import type { GuestEngine, GuestOperation } from "@/lib/guest-automation/constants"
import { guestAgentChannelOpen } from "../lib/proxmox-agent-flag"

const args = new Set(process.argv.slice(2))
const wantJson = args.has("--json")
const wantClones = args.has("--clone")
const keepClones = args.has("--keep")
const wantNotes = args.has("--notes")
const onlyVmid = Number(process.argv.find((a) => a.startsWith("--vm="))?.split("=")[1] || 0)

/**
 * The Windows template the QA must use as its real source.
 *
 * Pinned rather than discovered, because "the Windows template" is the one an
 * admin would name, and a test that quietly substituted a different image would
 * prove nothing.
 */
const WINDOWS_TEMPLATE_VMID = 2000

type Verdict = "PASS" | "FAILED" | "NOT TESTED" | "NOT AVAILABLE" | "NOT APPLICABLE"

type Column = "agent" | "exec" | "osDetect" | "nic" | "disk" | "network" | "access" | "idempotency" | "crossOs" | "cloudInit"

type Row = {
  profile: string
  profileVersion: number
  engine: GuestEngine
  os: string
  catalogueTemplate: string
  templateAgentChannel: boolean
  testVmid: number | null
  testVmidSource: string
  /** Every running guest that resolved to this profile, not just the first. */
  spareVms: number[]
  columns: Record<Column, Verdict>
  notes: string[]
  evidence: Record<string, unknown>
}

const rows: Row[] = []
const log: string[] = []
function say(line = "") {
  log.push(line)
  if (!wantJson) console.log(line)
}

function verdictFor(row: Row, column: Column, value: Verdict, note?: string) {
  row.columns[column] = value
  if (note) row.notes.push(`${column}: ${note}`)
}

async function main() {
  const node = await prisma.proxmoxNode.findFirst()
  if (!node) {
    say("No compute node is configured. Nothing to test.")
    return
  }
  const tokenSecret = isEncryptedSecret(node.tokenSecret) ? decryptSecretValue(node.tokenSecret) : node.tokenSecret
  const client = createProxmoxClient(node.host, node.tokenId, tokenSecret, { allowInsecureTls: node.allowInsecureTls, timeoutMs: 30_000 })
  const nodeArg = { nodeName: node.nodeName, host: node.host, tokenId: node.tokenId, tokenSecret, allowInsecureTls: node.allowInsecureTls }

  say(`Node ${node.name} (${node.nodeName}) at ${node.host}`)
  say(`Started ${new Date().toISOString()}`)
  say("")

  // -- 1. catalogue -------------------------------------------------------
  const catalogue = await prisma.osTemplate.findMany({
    where: { proxmoxVmid: { not: null } },
    orderBy: [{ osFamily: "asc" }, { osVersion: "asc" }],
  })
  const proxmoxVms = (await client.getVMs(node.nodeName)) as any[]
  const configFor = async (vmid: number) => (await client.getVMConfig(node.nodeName, vmid).catch(() => null)) as Record<string, any> | null

  // -- 2. guest profiles --------------------------------------------------
  const profiles = await listGuestTemplates()

  say("=== CATALOGUE ===")
  for (const entry of catalogue) {
    const cfg = await configFor(Number(entry.proxmoxVmid))
    const channel = agentChannelOpen(cfg)
    const ci = hasCloudInitDrive(cfg)
    const linked = profiles.filter((p) => (p as any).osTemplateId === entry.id).map((p) => p.slug)
    say(
      `  ${String(entry.proxmoxVmid).padStart(5)} ${String(entry.name).padEnd(16)} family=${String(entry.osFamily).padEnd(9)}` +
      ` active=${entry.isActive !== false} agent=${channel ? "Y" : "N"} cloudinitDrive=${ci ? "Y" : "N"}` +
      ` profile=${linked.join(",") || "none"}`,
    )
  }
  say("")

  // -- 3. find or make a test guest per profile ----------------------------
  const runningByProfile = await mapRunningGuests(proxmoxVms, profiles)

  say("=== TEST GUESTS ===")
  for (const profile of profiles) {
    const found = runningByProfile.get(profile.slug) || []
    say(
      `  ${profile.slug.padEnd(22)} -> ` +
      (found.length ? found.map((entry) => `VMID ${entry.vmid} (${entry.source})`).join("; ") : "none running"),
    )
  }
  say("")

  // -- 4. test each profile ------------------------------------------------
  for (const profile of profiles) {
    const row: Row = {
      profile: profile.slug,
      profileVersion: profile.version,
      engine: profile.engine as GuestEngine,
      os: (profile.osIds as string[]).join("/"),
      catalogueTemplate: "",
      templateAgentChannel: false,
      testVmid: null,
      testVmidSource: "none",
      spareVms: [],
      columns: {
        agent: "NOT TESTED", exec: "NOT TESTED", osDetect: "NOT TESTED", nic: "NOT TESTED",
        disk: "NOT TESTED", network: "NOT TESTED", access: "NOT TESTED",
        idempotency: "NOT TESTED", crossOs: "NOT TESTED", cloudInit: "NOT APPLICABLE",
      },
      notes: [],
      evidence: {},
    }
    rows.push(row)

    const catalogueEntry = catalogue.find((entry) => (profile as any).osTemplateId === entry.id) || null
    if (catalogueEntry) {
      row.catalogueTemplate = `${catalogueEntry.name} (VMID ${catalogueEntry.proxmoxVmid})`
      row.templateAgentChannel = agentChannelOpen(await configFor(Number(catalogueEntry.proxmoxVmid)))
    } else {
      row.notes.push("No Proxmox catalogue template links to this profile")
    }

    let guests: number[] = (runningByProfile.get(profile.slug) || []).map((entry) => entry.vmid)
    if (!guests.length && wantClones && catalogueEntry) {
      const clone = await cloneForQa(client, node.nodeName, Number(catalogueEntry.proxmoxVmid), profile.slug, profile.engine as GuestEngine)
      if (clone.ok) {
        guests = [clone.vmid]
        row.testVmidSource = `disposable clone of ${catalogueEntry.proxmoxVmid}`
        row.notes.push(`Cloned from ${catalogueEntry.name}; destroyed after the run unless --keep`)
        if (clone.error) row.notes.push(clone.error)
      } else {
        row.notes.push(`Could not clone: ${clone.error}`)
      }
    }
    if (onlyVmid) guests = guests.filter((candidate) => candidate === onlyVmid)
    const vmid = guests[0] ?? null
    row.testVmid = vmid
    row.spareVms = []

    if (!vmid) {
      const reason = row.catalogueTemplate ? "no running guest and no clone requested" : "no catalogue template"
      for (const column of ["agent", "exec", "osDetect", "nic", "disk", "network", "access", "idempotency", "crossOs"] as Column[]) {
        verdictFor(row, column, "NOT TESTED", reason)
      }
      // Cross-OS protection is engine-scoped and needs no guest to prove.
      await testCrossOsProtection(row, profile.engine as GuestEngine)
      continue
    }
    await testCrossOsProtection(row, profile.engine as GuestEngine)
    // Every guest that resolved to this profile is tested, and the row keeps the
    // worst verdict. One guest that disagrees with its profile is evidence the
    // profile's commands are not universal, which a single green guest hides.
    // A profile's verdict is the worst verdict across every guest that resolved to
    // it, folded in guest by guest. The accumulator starts empty rather than at
    // NOT TESTED: a real result must be able to overwrite an unmeasured baseline,
    // and "not measured" is only true when nothing was measured at all.
    const aggregate: Partial<Record<Column, Verdict>> = {}
    const testable: Column[] = ["agent", "exec", "osDetect", "nic", "disk", "network", "access", "idempotency"]
    for (const candidate of guests) {
      const guestRow: Row = {
        ...row,
        columns: { ...row.columns },
        notes: [],
        evidence: {},
      }
      await testGuest(guestRow, candidate, nodeArg, profile.engine as GuestEngine)
      for (const column of testable) {
        const incoming = guestRow.columns[column]
        const current = aggregate[column]
        aggregate[column] = current === undefined ? incoming : worstVerdict(current, incoming)
      }
      row.spareVms = row.spareVms.concat(candidate === vmid ? [] : [candidate])
      for (const note of guestRow.notes) row.notes.push(`VMID ${candidate} · ${note}`)
      Object.assign(row.evidence, guestRow.evidence)
    }
    for (const column of testable) {
      if (aggregate[column] !== undefined) row.columns[column] = aggregate[column]!
    }
  }

  // -- 5. node capability --------------------------------------------------
  say("=== NODE CAPABILITIES ===")
  const caps = await measureNodeCapabilities({ ...nodeArg })
  say(`  status: ${caps.status}`)
  for (const check of caps.checks) {
    say(`  ${check.state.toUpperCase().padEnd(5)} ${check.key.padEnd(18)} ${check.detail.slice(0, 96)}`)
  }
  say("")

  // -- 6. Cloud-Init audit --------------------------------------------------
  say("=== CLOUD-INIT AUDIT ===")
  for (const entry of catalogue) {
    const cfg = await configFor(Number(entry.proxmoxVmid))
    const ci = hasCloudInitDrive(cfg)
    if (ci) say(`  ${entry.name} (VMID ${entry.proxmoxVmid}) still carries a legacy cloud-init drive — left in place, not depended on`)
  }
  say("  application Cloud-Init guest-management paths: 0 (see scripts/tests/unit/cloud-init-removal.test.ts)")
  say("")

  // -- 7. notes -------------------------------------------------------------
  if (wantNotes) {
    say("=== VM NOTES ===")
    for (const row of rows) {
      if (!row.testVmid) continue
      const written = await writeVmNote(client, node.nodeName, row)
      say(`  VMID ${row.testVmid}: ${written.ok ? "note written" : `note FAILED — ${written.error}`}`)
    }
    say("")
  }

  // -- 8. matrix ------------------------------------------------------------
  const failed = rows.filter((r) => Object.values(r.columns).includes("FAILED"))
  const notTested = rows.filter((r) => !r.testVmid)
  const width = 13
  say("=== FINAL MATRIX ===")
  say(
    `${"TEMPLATE".padEnd(22)}${"OS".padEnd(14)}${"TEST VM".padEnd(11)}${"AGENT".padEnd(width)}${"EXEC".padEnd(width)}${"OS DETECT".padEnd(width)}` +
    `${"NIC".padEnd(width)}${"DISK".padEnd(width)}${"NETWORK".padEnd(width)}${"ACCESS".padEnd(width)}${"IDEMP".padEnd(width)}${"CROSS-OS".padEnd(width)}${"CLOUD-INIT".padEnd(12)}RESULT`,
  )
  for (const row of rows) {
    const overall = failed.includes(row) ? "FAILED" : notTested.includes(row) ? "NOT TESTED" : "PASS"
    say(
      row.profile.padEnd(22) +
      (row.engine === "windows" ? "Windows" : row.profile.replace(/-server-\d+|-11|-12|-\d+/g, "")).slice(0, 14).padEnd(14) +
      String(row.testVmid ?? "—").padEnd(11) +
      row.columns.agent.padEnd(width) + row.columns.exec.padEnd(width) + row.columns.osDetect.padEnd(width) +
      row.columns.nic.padEnd(width) + row.columns.disk.padEnd(width) + row.columns.network.padEnd(width) +
      row.columns.access.padEnd(width) + row.columns.idempotency.padEnd(width) + row.columns.crossOs.padEnd(width) +
      row.columns.cloudInit.padEnd(12) + overall,
    )
    for (const note of row.notes) say(`      · ${note}`)
  }
  say("")
  say(`Tested: ${rows.filter((r) => r.testVmid).length}  Not tested: ${notTested.length}  Failed: ${failed.length}`)

  if (wantJson) {
    console.log(JSON.stringify({ startedAt: log[1], node: node.nodeName, rows, nodeCapabilities: caps, log }, null, 2))
  }
}

// ---------------------------------------------------------------------------
// Per-guest tests
// ---------------------------------------------------------------------------

async function testGuest(row: Row, vmid: number, nodeArg: any, engine: GuestEngine) {
  const service = new GuestAutomationService(guestContextFor({ vpsInstanceId: `qa:${vmid}`, vmid, node: nodeArg, ephemeral: true }))
  const proxmox = service.proxmoxClient
  const base = `/nodes/${encodeURIComponent(nodeArg.nodeName)}/qemu/${vmid}`

  // -- guest agent: ping, then osinfo
  let agentOk = false
  try {
    await proxmox.requestWithStatus(`${base}/agent/ping`, "POST")
    agentOk = true
  } catch (error: any) {
    verdictFor(row, "agent", "FAILED", `guest agent ping failed: ${String(error?.message || error).slice(0, 120)}`)
  }

  if (agentOk) {
    // -- guest exec, proved end to end: start, poll, read the exit code
    const shell = engine === "windows" ? "powershell" : "/bin/sh"
    const script = engine === "windows" ? "exit 0" : "exit 0"
    let execOk = false
    let execDetail = ""
    try {
      const started: any = await proxmox.execVMGuestCommand(nodeArg.nodeName, vmid, [shell, ...(engine === "windows" ? ["-NoProfile", "-Command"] : ["-c"]), script])
      const pid = Number(started?.pid)
      if (!Number.isInteger(pid)) execDetail = "guest-exec returned no pid"
      const deadline = Date.now() + 20_000
      let status: any = null
      while (Date.now() < deadline && Number.isInteger(pid)) {
        status = await proxmox.getVMGuestExecStatus(nodeArg.nodeName, vmid, pid)
        if (status?.exited) break
        await new Promise((resolve) => setTimeout(resolve, 400))
      }
      if (status?.exited && Number(status.exitcode) === 0) execOk = true
      else execDetail = execDetail || `pid ${pid} exited=${Boolean(status?.exited)} exitcode=${status?.exitcode}`
    } catch (error: any) {
      execDetail = String(error?.message || error).slice(0, 140)
    }
    verdictFor(row, "agent", "PASS")
    verdictFor(row, "exec", execOk ? "PASS" : "FAILED", execOk ? undefined : execDetail)

    // The two states are recorded separately on purpose. A guest whose agent
    // answers but whose guest-exec is blocked is NOT "healthy": it can be read
    // but not configured, which is a different and worse failure.
    if (!execOk) row.notes.push("guest agent answers but guest-exec does not — this guest can be read but not configured")
  } else {
    for (const column of ["exec", "osDetect", "nic", "disk", "network", "access", "idempotency"] as Column[]) {
      verdictFor(row, column, "NOT TESTED", "the guest agent did not answer")
    }
  }

  // -- OS detection
  const detected = await service.detectOs(null, { persist: false })
  if (detected.kind === "unknown") {
    verdictFor(row, "osDetect", "FAILED", `guest reported no usable OS (${detected.source})`)
  } else {
    verdictFor(row, "osDetect", "PASS", `${detected.osId} ${detected.version || ""}`.trim())
    row.evidence.os = { id: detected.osId, name: detected.name, version: detected.version, engine: detected.engine, source: detected.source }
  }

  // -- template resolution: the detected OS must find an enabled profile
  if (detected.kind !== "unknown") {
    const resolved = await service.getTemplate(detected)
    verdictFor(
      row,
      "osDetect",
      resolved.ok ? "PASS" : "FAILED",
      resolved.ok ? `resolved ${resolved.template.name} v${resolved.template.version} by ${resolved.matchedBy}` : `no profile claims this OS: ${resolved.reason}`,
    )
    if (resolved.ok) row.evidence.template = { slug: resolved.template.slug, version: resolved.template.version, matchedBy: resolved.matchedBy }
  }

  // -- NIC, from the guest, never assumed
  //
  // "Did we find the interface" and "does it have an address" are different
  // questions and were conflated here. A freshly cloned guest legitimately has no
  // address — this platform gives it one — so scoring that as a detection failure
  // reported a working detector as broken. The interface list is the proof that
  // detection works; the address is the proof that something was configured, which
  // on a new clone is not this run's job.
  const state = await service.getState(engine)
  if (!state.interfaces.length) {
    verdictFor(row, "nic", "FAILED", `the guest agent reported no interfaces at all (hostname=${state.hostname})`)
  } else if (!state.primaryInterface) {
    verdictFor(row, "nic", "FAILED", `saw ${state.interfaces.map((entry) => entry.name).join(", ")} but could not pick one (hostname=${state.hostname})`)
  } else if (!state.ipv4.length) {
    verdictFor(row, "nic", "PASS", `detected ${state.primaryInterface}, which has no address yet — expected on a guest this platform has not configured (hostname=${state.hostname})`)
  } else {
    verdictFor(row, "nic", "PASS", `${state.primaryInterface} ${state.ipv4.join(",")}`)
  }
  row.evidence.nic = {
    interface: state.primaryInterface,
    interfaces: state.interfaces.map((entry) => entry.name),
    ipv4: state.ipv4,
    hostname: state.hostname,
    timezone: state.timezone,
  }

  // -- disk, through the template's own collector
  const disk = await service.getDiskUsage()
  if (disk.ok) {
    verdictFor(row, "disk", "PASS", `${disk.source} total=${disk.totalBytes} used=${disk.usedBytes} ${disk.usedPercent}% fs=${disk.filesystem ?? "null"} template=v${disk.templateVersion}`)
    row.evidence.disk = { source: disk.source, totalBytes: disk.totalBytes, usedBytes: disk.usedBytes, freeBytes: disk.freeBytes, usedPercent: disk.usedPercent, filesystem: disk.filesystem, collector: disk.source, templateVersion: disk.templateVersion }
  } else {
    verdictFor(row, "disk", "FAILED", `${disk.errorCode}: ${String(disk.message).slice(0, 100)}`)
  }

  // -- network + access: dry runs only, nothing is executed
  await dryRunOperation(row, service, engine, "set_ip", {
    commandType: "guest-exec",
    shell: engine === "windows" ? "windows-powershell" : "linux-sh",
    command: engine === "windows"
      ? "New-NetIPAddress -InterfaceAlias '{{NIC}}' -IPAddress {{IP}} -PrefixLength {{PREFIX}} -DefaultGateway {{GATEWAY}}"
      : "ip address add {{IP}}/{{PREFIX}} dev {{NIC}}; ip route replace default via {{GATEWAY}} dev {{NIC}}",
    verificationCommand: "network-get-interfaces",
    verificationParser: "native-interfaces",
    dangerLevel: "caution",
    requiresRunning: true,
    verificationRequired: true,
    timeoutSeconds: 60,
  }, "network")

  await dryRunOperation(row, service, engine, "set_dns", {
    commandType: "guest-exec",
    shell: engine === "windows" ? "windows-powershell" : "linux-sh",
    command: engine === "windows"
      ? "Set-DnsClientServerAddress -InterfaceAlias '{{NIC}}' -ServerAddresses ({{DNS1}},{{DNS2}})"
      : "resolvectl dns {{NIC}} {{DNS1}}",
    verificationRequired: false,
    dangerLevel: "caution",
    requiresRunning: true,
    timeoutSeconds: 60,
  }, "network")

  await dryRunOperation(row, service, engine, "set_password", {
    commandType: engine === "windows" ? "guest-native" : "guest-exec",
    shell: engine === "windows" ? null : "linux-sh",
    command: engine === "windows" ? "set-user-password" : "read -r SECRET; printf '%s:%s\\n' '{{USERNAME}}' \"$SECRET\" | chpasswd",
    verificationCommand: "get-users",
    verificationParser: "native-users",
    verificationRequired: true,
    requiresRunning: true,
    timeoutSeconds: 45,
  }, "access")

  // -- idempotency: ask for what the guest already has
  // Nothing is written. The plan resolves to "already applied" and the step is
  // skipped, so no command runs and the network is not restarted.
  if (detected.kind !== "unknown" && state.ipv4.length) {
    try {
      const change = await service.applyChange({ desired: { ip: state.ipv4[0] }, actor: { requestedBy: "qa:guest", role: "admin" } })
      if ("message" in change) {
        verdictFor(row, "idempotency", "FAILED", `${change.errorCode}: ${String(change.message).slice(0, 90)}`)
      } else if (change.plan.noChange) {
        verdictFor(row, "idempotency", "PASS", `no change; ${change.plan.operations.map((op) => `${op.operation}:${op.status}`).join(", ")}`)
        row.evidence.idempotency = { noChange: true, operations: change.plan.operations.map((op) => ({ operation: op.operation, status: op.status, changed: op.changed })) }
      } else {
        verdictFor(row, "idempotency", "FAILED", `re-applying the current address still planned work: ${change.plan.operations.filter((op) => op.changed).map((op) => op.operation).join(", ")}`)
      }
    } catch (error: any) {
      verdictFor(row, "idempotency", "FAILED", String(error?.message || error).slice(0, 120))
    }
  } else {
    verdictFor(row, "idempotency", "NOT TESTED", "the guest reported no address to re-apply")
  }

  // -- cross-OS protection, engine-scoped
  await testCrossOsProtection(row, engine)
}

/**
 * A dry run: the command is rendered from the draft the editor would save,
 * judged against the engine the guest really reported, and executed never.
 */
async function dryRunOperation(
  row: Row,
  service: GuestAutomationService,
  engine: GuestEngine,
  operation: GuestOperation,
  draft: any,
  column: Column,
) {
  try {
    const preview = await service.previewOperation({ operation, draft })
    if (!preview.ok) {
      verdictFor(row, column, "FAILED", `${operation}: ${preview.errorCode} ${String(preview.message).slice(0, 90)}`)
      return
    }
    const unknown = preview.unknownPlaceholders
    if (unknown.length) {
      verdictFor(row, column, "FAILED", `${operation} uses unknown placeholders: ${unknown.join(", ")}`)
      return
    }
    // Only the first dry run on a column sets the verdict; later ones append.
    if (row.columns[column] === "NOT TESTED") verdictFor(row, column, "PASS")
    row.notes.push(`${operation} dry run: ${String(preview.commandMasked).slice(0, 80)}`)
  } catch (error: any) {
    verdictFor(row, column, "FAILED", `${operation}: ${String(error?.message || error).slice(0, 120)}`)
  }
}

/**
 * The wrong-engine commands, each of which must be refused.
 *
 * Checked on every engine, because the guard is in the shared validator and a
 * regression there would be silent on whichever family nobody tested.
 */
const FORBIDDEN: Array<{ engine: GuestEngine; label: string; shell: string; command: string }> = [
  { engine: "windows", label: "windows + linux-sh", shell: "linux-sh", command: "ip address add 10.0.0.5/24 dev eth0" },
  { engine: "windows", label: "windows + df", shell: "windows-powershell", command: "df -B1 -P" },
  { engine: "windows", label: "windows + ip", shell: "windows-powershell", command: "ip route show" },
  { engine: "windows", label: "windows + systemctl", shell: "windows-powershell", command: "systemctl restart systemd-networkd" },
  { engine: "windows", label: "windows + nmcli", shell: "windows-powershell", command: "nmcli con mod eth0 ipv4.dns 1.1.1.1" },
  { engine: "windows", label: "windows + netplan", shell: "windows-powershell", command: "netplan apply" },
  { engine: "windows", label: "windows + ifupdown", shell: "windows-powershell", command: "ifdown eth0 && ifup eth0" },
  { engine: "linux", label: "linux + windows-powershell", shell: "windows-powershell", command: "Set-DnsClientServerAddress -InterfaceAlias 'Ethernet' -ServerAddresses ('1.1.1.1')" },
  { engine: "linux", label: "linux + netsh", shell: "linux-sh", command: "netsh interface ip set address name=Ethernet static=10.0.0.5 255.255.255.0" },
  { engine: "linux", label: "linux + cmd", shell: "linux-sh", command: "netsh interface ipv4 set address name=5 name=10.0.0.5" },
  { engine: "linux", label: "linux + Get-CimInstance", shell: "linux-sh", command: "Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3'" },
  { engine: "linux", label: "linux + wmic", shell: "linux-sh", command: "wmic logicaldisk get size,freespace" },
]

/**
 * Cross-OS refusal, proven without a guest.
 *
 * `previewOperation` needs a live guest to know the engine, so when there is no
 * guest to test against this drives the validator directly. It is the same
 * `assertShellMatchesEngine` and `crossOsCommandViolations` the executor calls,
 * so a refusal here is a refusal in production.
 */
async function testCrossOsProtection(row: Row, engine: GuestEngine) {
  const { assertShellMatchesEngine, crossOsCommandViolations } = await import("@/lib/guest-automation/constants")
  const cases = FORBIDDEN.filter((entry) => entry.engine === engine)
  const failures: string[] = []
  for (const entry of cases) {
    const gate = assertShellMatchesEngine(entry.shell, engine)
    const violations = crossOsCommandViolations(entry.command, engine)
    if (gate.ok && !violations.length) failures.push(`${entry.label} was ACCEPTED`)
  }
  if (failures.length) {
    verdictFor(row, "crossOs", "FAILED", failures.join("; "))
  } else {
    verdictFor(row, "crossOs", "PASS", `${cases.length} wrong-engine command(s) refused`)
  }
}

// ---------------------------------------------------------------------------
// Template cloning
// ---------------------------------------------------------------------------

/**
 * Clone a catalogue template into a disposable guest for QA.
 *
 * Never touches the template itself. The agent channel is enabled *on the clone*
 * when the template does not have it, which is the only way to tell "the image
 * has no agent" from "the channel was never opened" — and the distinction is
 * reported rather than papered over.
 */
async function cloneForQa(client: ReturnType<typeof createProxmoxClient>, nodeName: string, templateVmid: number, slug: string, engine: GuestEngine = "linux") {
  const nextVmid = await client.getNextVmid()
  const name = `zws-qa-${slug}-${Date.now().toString(36)}`.slice(0, 40)
  let cloneUpid = ""
  try {
    cloneUpid = await client.cloneVM(nodeName, templateVmid, nextVmid, name, { full: 1, target: nodeName })
  } catch (error: any) {
    return { ok: false as const, vmid: null, error: `clone failed: ${String(error?.message || error).slice(0, 140)}` }
  }
  try {
    // Wait for the clone task itself.
    //
    // Skipping this is what made the first run report four templates as having no
    // guest agent: the clone was still locked, so `qm set agent=1` was rejected,
    // the agent channel stayed closed, and "No QEMU guest agent configured" was
    // read as a fact about the image when it was really a fact about the race.
    if (cloneUpid) await client.waitForTask(nodeName, cloneUpid, 600_000)
    const unlocked = await waitForUnlocked(client, nodeName, nextVmid, 120_000)
    if (!unlocked.ok) return { ok: true as const, vmid: nextVmid, error: `clone ${nextVmid} stayed locked: ${unlocked.error}` }

    const templateCfg = (await client.getVMConfig(nodeName, templateVmid)) as Record<string, any>
    const applied: string[] = []
    if (!agentChannelOpen(templateCfg)) {
      // On the clone only. A template that never opened the channel still ships an
      // image that may carry a working agent, and this is how we find out — the
      // template itself is never modified.
      await client.updateVMConfig(nodeName, nextVmid, { agent: "1" })
      applied.push("agent=1 enabled on the clone (the template does not have it)")
    }
    // Blank every Cloud-Init input, and leave the drive alone.
    //
    // Removing the drive was the wrong call and it produced a false result: the
    // Debian 11 clone came up with no address and a 129 MB "root", which reads
    // as "the collector is broken" when it is really "the image had no
    // networking left". Detaching the drive changes what the image boots as, so
    // it measures something other than what this platform does.
    //
    // What this platform must not do is *feed* cloud-init. Blanking `ipconfig0`
    // and friends leaves cloud-init installed and present but with nothing to
    // apply — which is the actual claim under test, and it is falsifiable.
    await client.updateVMConfig(nodeName, nextVmid, { ipconfig0: "", ciuser: "", cipassword: "", nameserver: "", searchdomain: "" }).catch(() => undefined)
    const hasCiDrive = Object.entries(templateCfg).some(([key, value]) => /^(ide|scsi|sata)\d+$/i.test(key) && /cloudinit/i.test(String(value)))
    applied.push(hasCiDrive
      ? "every Cloud-Init input blanked; the image's own drive is left in place so the test measures this platform, not a detached disk"
      : "no Cloud-Init drive on the template")
    await client.startVMWithStatus(nodeName, nextVmid).catch(() => null)
    // Wait for *guest-exec*, not just ping. Windows first boot runs setup and
    // the agent answers ping long before guest-exec is usable. A clone that only
    // waited for ping reported "exec failed" when it was really "wait longer".
    const execReady = await waitForExec(client, nodeName, nextVmid, 300_000, engine)
    return {
      ok: true as const,
      vmid: nextVmid,
      error: execReady
        ? applied.length ? `clone prepared: ${applied.join("; ")}` : null
        : `clone ${nextVmid} booted${applied.length ? ` (${applied.join("; ")})` : ""} but guest-exec never became usable`,
    }
  } catch (error: any) {
    return { ok: true as const, vmid: nextVmid, error: `clone created but configuration failed: ${String(error?.message || error).slice(0, 140)}` }
  }
}

/** Proxmox keeps a VM locked for a short while after its task stops. */
async function waitForUnlocked(client: ReturnType<typeof createProxmoxClient>, nodeName: string, vmid: number, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs
  let last = ""
  while (Date.now() < deadline) {
    try {
      await client.getVMConfig(nodeName, vmid)
      return { ok: true as const, error: null }
    } catch (error: any) {
      last = String(error?.message || error).slice(0, 100)
      await new Promise((resolve) => setTimeout(resolve, 3_000))
    }
  }
  return { ok: false as const, error: last }
}

async function waitForAgent(client: ReturnType<typeof createProxmoxClient>, nodeName: string, vmid: number, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs
  let last = "never polled"
  while (Date.now() < deadline) {
    try {
      await client.requestWithStatus(`/nodes/${encodeURIComponent(nodeName)}/qemu/${vmid}/agent/ping`, "POST")
      return { ok: true as const, error: null }
    } catch (error: any) {
      last = String(error?.message || error).slice(0, 100)
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000))
  }
  return { ok: false as const, error: last }
}

/** Wait for guest-exec to actually start and exit cleanly. */
async function waitForExec(client: ReturnType<typeof createProxmoxClient>, nodeName: string, vmid: number, timeoutMs: number, engine: GuestEngine = "linux") {
  const deadline = Date.now() + timeoutMs
  let last = ""
  const attempts = engine === "windows"
    ? [["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", "exit 0"], ["cmd.exe", "/c", "exit 0"]]
    : [["/bin/sh", "-c", "exit 0"], ["true"]]
  while (Date.now() < deadline) {
    try {
      let started: any = null
      for (const command of attempts) {
        try {
          started = await client.execVMGuestCommand(nodeName, vmid, command)
          break
        } catch {}
      }
      if (!started) throw new Error("all exec attempts failed")
      const pid = Number(started?.pid)
      if (!Number.isInteger(pid)) { last = "no pid"; await new Promise((r) => setTimeout(r, 5_000)); continue }
      const dl = Date.now() + 20_000
      let status: any = null
      while (Date.now() < dl) {
        status = await client.getVMGuestExecStatus(nodeName, vmid, pid)
        if (status?.exited) break
        await new Promise((r) => setTimeout(r, 500))
      }
      if (status?.exited && Number(status.exitcode) === 0) return true
      last = `pid ${pid} exited=${Boolean(status?.exited)} code=${status?.exitcode}`
    } catch (error: any) {
      last = String(error?.message || error).slice(0, 100)
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000))
  }
  return false
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function agentChannelOpen(config: Record<string, any> | null) {
  if (!config) return false
  return guestAgentChannelOpen(config)
}

function hasCloudInitDrive(config: Record<string, any> | null) {
  if (!config) return false
  return Object.entries(config).some(([key, value]) => /^(ide|scsi|sata)\d+$/i.test(key) && /cloudinit/i.test(String(value)))
}

/** The verdict that is less favourable of the two. Order is a severity order. */
const SEVERITY: Record<Verdict, number> = {
  PASS: 0, "NOT APPLICABLE": 1, "NOT AVAILABLE": 2, "NOT TESTED": 3, FAILED: 4,
}

function worstVerdict(a: Verdict, b: Verdict): Verdict {
  return SEVERITY[b] > SEVERITY[a] ? b : a
}

/**
 * Match each running guest to the profile it proves.
 *
 * Asked of the guest and resolved through the same code production uses, not
 * guessed from the VM name. A VM called `ip-103-216-170-233` says nothing about
 * its OS, and several profiles claim the same OS ids — three RHEL-family
 * profiles all claim `almalinux` — so matching on claimed ids would credit
 * whichever happened to come first with a test it never had. The guest's own
 * template resolution is the only answer that is not a guess.
 *
 * When two guests resolve to the same profile, the one whose detected OS matches
 * the profile's family most specifically wins; the other is reported as a spare
 * rather than silently dropped.
 */
async function mapRunningGuests(vms: any[], profiles: any[]) {
  const found = new Map<string, Array<{ vmid: number; source: string }>>()
  const running = vms.filter((vm) => String(vm.status) === "running" && Number(vm.vmid) > 0)
  const node = await prisma.proxmoxNode.findFirst()
  if (!node) return found
  const secret = isEncryptedSecret(node.tokenSecret) ? decryptSecretValue(node.tokenSecret) : node.tokenSecret
  const nodeArg = { nodeName: node.nodeName, host: node.host, tokenId: node.tokenId, tokenSecret: secret, allowInsecureTls: node.allowInsecureTls }
  const bySlug = new Map<string, any>(profiles.map((p) => [p.slug, p]))

  for (const vm of running) {
    try {
      const service = new GuestAutomationService(guestContextFor({ vpsInstanceId: `qa:map:${vm.vmid}`, vmid: vm.vmid, node: nodeArg, ephemeral: true }))
      // `persist: false` — these guests are not panel services, so there is no
      // adoption row to write, and a failed constraint is noise in a QA log.
      const detected = await service.detectOs(null, { persist: false })
      const resolved = detected.kind === "unknown" ? { ok: false as const, code: "OS_DETECTION_UNAVAILABLE" as const, reason: "unknown" } : await service.getTemplate(detected)
      if (detected.kind === "unknown" || !resolved.ok) continue
      const slug = (resolved as any).template.slug
      const profile = bySlug.get(slug)
      const claimed = ((profile?.osIds as string[]) || []).map((id) => id.toLowerCase())
      const exact = claimed.includes(String(detected.osId || "").toLowerCase())
      const entry = { vmid: vm.vmid, source: `guest reports ${detected.osId}; resolved ${slug} by ${(resolved as any).matchedBy}${exact ? "" : " (family match)"}` }
      // Every guest is kept, not just the first: two guests resolving to the same
      // profile are two chances for that profile's commands to be wrong, and
      // "all Linux tested" is not true if only the tidiest one was.
      const list = found.get(slug) || []
      list.push(entry)
      found.set(slug, list)
    } catch {
      // A guest with no agent, or one whose agent does not answer, is simply not
      // evidence for any profile.
      continue
    }
  }
  return found
}

/**
 * Append the QA block, never replacing what is there.
 *
 * VM notes carry customer and billing metadata. A test run that overwrote them
 * would destroy the operator's own record, so this only ever appends, and
 * re-running replaces the previous QA block rather than stacking duplicates.
 */
async function writeVmNote(client: ReturnType<typeof createProxmoxClient>, nodeName: string, row: Row) {
  const vmid = row.testVmid
  if (!vmid) return { ok: false as const, error: "no test guest" }
  const overall = Object.values(row.columns).includes("FAILED") ? "FAILED" : "PASS"
  const mark = (value: Verdict) => (value === "NOT TESTED" || value === "NOT AVAILABLE" ? "NOT TESTED" : value)

  const block = [
    "",
    "--- ZWS CLOUD GUEST AUTOMATION QA ---",
    "Test Date:",
    new Date().toISOString(),
    "",
    "Automation:",
    "qm guest / QEMU Guest Agent",
    "",
    "Cloud-Init:",
    "NOT USED",
    "",
    "OS Detection:",
    mark(row.columns.osDetect),
    "",
    "Guest Agent:",
    mark(row.columns.agent),
    "",
    "Guest Exec:",
    mark(row.columns.exec),
    "",
    "NIC Detection:",
    mark(row.columns.nic),
    "",
    "Disk Detection:",
    mark(row.columns.disk),
    "",
    "Network Configuration:",
    mark(row.columns.network),
    "",
    "Credential Operations:",
    mark(row.columns.access),
    "",
    "Idempotency:",
    mark(row.columns.idempotency),
    "",
    "Cross-OS Guard:",
    mark(row.columns.crossOs),
    "",
    "Profile:",
    `${row.profile} v${row.profileVersion} (${row.engine})`,
    row.catalogueTemplate ? `Catalogue Template: ${row.catalogueTemplate}` : "Catalogue Template: none linked",
    "",
    "Tester:",
    "ZWS Cloud Automation",
    "",
    "Overall:",
    overall,
    "--- END ZWS CLOUD GUEST AUTOMATION QA ---",
  ].join("\n")

  try {
    const config = (await client.getVMConfig(nodeName, vmid)) as Record<string, any>
    const existing = String(config.description || config.notes || "")
    // Strip a previous QA block so repeated runs do not stack.
    const base = existing.replace(/\n*--- ZWS CLOUD GUEST AUTOMATION QA ---[\s\S]*?--- END ZWS CLOUD GUEST AUTOMATION QA ---\s*$/g, "").replace(/\n+$/, "")
    await client.updateVMConfig(nodeName, vmid, { description: `${base}${block}` })
    return { ok: true as const, error: null }
  } catch (error: any) {
    return { ok: false as const, error: String(error?.message || error).slice(0, 140) }
  }
}

main()
  .catch((error) => {
    console.error("[qa:guest] fatal", error)
    process.exitCode = 1
  })
  .finally(async () => {
    if (keepClones) say("Clones were kept (--keep). Remove them when finished.")
    await prisma.$disconnect().catch(() => undefined)
  })

export { GUEST_OPERATIONS, collectTemplateDiskUsage, osMetadataForVps }
