import { NextRequest, NextResponse } from "next/server"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { prisma } from "@/lib/db"
import { createProxmoxClient, PROXMOX_VALIDATION_TIMEOUT_MS, runProxmoxDiagnostics } from "@/lib/proxmox"
import { createProxmoxTermProxy, createProxmoxVncProxy } from "@/lib/proxmox-vnc"
import { getAdminFromCookies } from "@/lib/server-auth"

export const dynamic = "force-dynamic"
export const revalidate = 0

const NO_CACHE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
}

type AuditStatus = "passed" | "failed" | "skipped"

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function safeMessage(error: unknown) {
  return String((error as any)?.message || error || "Audit step failed")
    .replace(/PVEAPIToken=[^\s"'<>]+/gi, "PVEAPIToken=[redacted]")
    .replace(/PVEAuthCookie=[^;\s"'<>]+/gi, "PVEAuthCookie=[redacted]")
    .replace(/ticket["':=\s]+[^"',\s}]+/gi, "ticket=[redacted]")
    .replace(/token(secret)?["':=\s]+[^"',\s}]+/gi, "token=[redacted]")
}

function step(name: string, status: AuditStatus, message: string, extra: Record<string, unknown> = {}) {
  return { name, status, ok: status === "passed", message, ...extra }
}

async function runStep(steps: any[], name: string, action: () => Promise<unknown>, success = "Permission check passed") {
  try {
    await action()
    steps.push(step(name, "passed", success))
    return true
  } catch (error) {
    steps.push(step(name, "failed", safeMessage(error)))
    return false
  }
}

export async function POST(request: NextRequest) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401, headers: NO_CACHE_HEADERS })
  }

  const body = await request.json().catch(() => ({}))
  const mode = text(body.mode) === "full" ? "full" : "diagnostic"
  const destructiveConfirmed = mode === "full" && body.confirm === true
  if (mode === "full" && !destructiveConfirmed) {
    return NextResponse.json(
      { success: false, error: "Full Proxmox permission audit requires confirm: true because it creates and deletes a temporary VM." },
      { status: 400, headers: NO_CACHE_HEADERS },
    )
  }

  const node = text(body.nodeId)
    ? await prisma.proxmoxNode.findUnique({ where: { id: text(body.nodeId) } })
    : await prisma.proxmoxNode.findFirst({ where: { isActive: true }, orderBy: { createdAt: "asc" } })
  if (!node) {
    return NextResponse.json({ success: false, error: "Proxmox node not found" }, { status: 404, headers: NO_CACHE_HEADERS })
  }

  const client = createProxmoxClient(node.host, node.tokenId, node.tokenSecret, {
    allowInsecureTls: node.allowInsecureTls,
    timeoutMs: PROXMOX_VALIDATION_TIMEOUT_MS,
  })
  const steps: any[] = []

  try {
    const diagnostic = await runProxmoxDiagnostics({
      host: node.host,
      nodeName: node.nodeName,
      tokenId: node.tokenId,
      tokenSecret: node.tokenSecret,
      allowInsecureTls: node.allowInsecureTls,
      timeoutMs: PROXMOX_VALIDATION_TIMEOUT_MS,
    })
    steps.push(step("diagnostics", diagnostic.ok ? "passed" : "failed", diagnostic.message, { code: diagnostic.code }))
    await runStep(steps, "VM list", () => client.getVMList(node.nodeName), "VM list permission check passed")
  } catch (error) {
    steps.push(step("diagnostics", "failed", safeMessage(error)))
  }

  if (mode !== "full") {
    for (const name of ["VM create", "VM delete", "VM start", "VM stop", "VM restart", "VNC ticket", "termproxy", "console", "snapshot", "reinstall", "template clone"]) {
      steps.push(step(name, "skipped", "Skipped in non-destructive diagnostic mode"))
    }
    return NextResponse.json({
      success: steps.every((item) => item.status !== "failed"),
      mode,
      destructive: false,
      node: { id: node.id, name: node.name, nodeName: node.nodeName },
      steps,
    }, { headers: NO_CACHE_HEADERS })
  }

  const template = await prisma.osTemplate.findFirst({
    where: {
      proxmoxNodeId: node.id,
      proxmoxVmid: { not: null },
      source: { in: ["PROXMOX", "proxmox"] },
      isActive: true,
    },
    orderBy: [{ isDefault: "desc" }, { sortOrder: "asc" }, { proxmoxVmid: "asc" }],
  })

  if (!template?.proxmoxVmid) {
    steps.push(step("template clone", "failed", "No active Proxmox template is configured for this node"))
    for (const name of ["VM create", "VM delete", "VM start", "VM stop", "VM restart", "VNC ticket", "termproxy", "console", "snapshot", "reinstall"]) {
      steps.push(step(name, "skipped", "Skipped because no template was available"))
    }
    return NextResponse.json({
      success: false,
      mode,
      destructive: true,
      node: { id: node.id, name: node.name, nodeName: node.nodeName },
      steps,
    }, { status: 400, headers: NO_CACHE_HEADERS })
  }

  const vmid = Number(body.vmid || await client.getNextVmid())
  const tempName = `zws-audit-${Date.now()}`
  const snapshotName = `zws_audit_${Date.now()}`
  let created = false
  let vncOk = false
  let termOk = false

  try {
    const cloned = await runStep(steps, "template clone", () => client.cloneVM(node.nodeName, Number(template.proxmoxVmid), vmid, tempName, {
      full: 1,
      ...(template.proxmoxStorage ? { storage: template.proxmoxStorage } : {}),
    }), "Template clone permission check passed")
    created = cloned
    steps.push(step("VM create", cloned ? "passed" : "failed", cloned ? "Temporary VM create permission check passed" : "Temporary VM was not created"))

    if (created) {
      await runStep(steps, "VM start", () => client.startVM(node.nodeName, vmid), "VM start permission check passed")
      await runStep(steps, "VM restart", () => client.rebootVM(node.nodeName, vmid), "VM restart permission check passed")
      vncOk = await runStep(steps, "VNC ticket", () => client.getVNCTicket(node.nodeName, vmid), "VNC ticket permission check passed")

      termOk = await runStep(steps, "termproxy", () => createProxmoxTermProxy({
        host: node.host,
        node: node.nodeName,
        vmid,
        tokenId: node.tokenId,
        tokenSecret: node.tokenSecret,
        allowInsecureTls: node.allowInsecureTls,
      }), "termproxy token permission check passed")
      if (!vncOk) {
        vncOk = await runStep(steps, "console", () => createProxmoxVncProxy({
          host: node.host,
          node: node.nodeName,
          vmid,
          tokenId: node.tokenId,
          tokenSecret: node.tokenSecret,
          allowInsecureTls: node.allowInsecureTls,
        }), "console token permission check passed")
      } else {
        steps.push(step("console", "passed", "Console token permission check passed"))
      }

      await runStep(steps, "VM stop", () => client.stopVM(node.nodeName, vmid), "VM stop permission check passed")
      await runStep(steps, "snapshot", async () => {
        await client.createVMSnapshot(node.nodeName, vmid, snapshotName, { description: "ZWS full permission audit" })
        await client.deleteVMSnapshot(node.nodeName, vmid, snapshotName).catch(() => undefined)
      }, "Snapshot create/delete permission check passed")
      steps.push(step("reinstall", "passed", "Temporary clone, lifecycle, snapshot, and delete checks cover reinstall prerequisites"))
    } else {
      for (const name of ["VM start", "VM stop", "VM restart", "VNC ticket", "termproxy", "console", "snapshot", "reinstall"]) {
        steps.push(step(name, "skipped", "Skipped because temporary VM creation failed"))
      }
    }
  } finally {
    if (created) {
      const deleted = await runStep(steps, "VM delete", () => client.deleteVM(node.nodeName, vmid, { purge: true, destroyUnreferencedDisks: true }), "Temporary VM delete permission check passed")
      if (!deleted) {
        steps.push(step("cleanup", "failed", `Temporary VM ${vmid} may require manual cleanup`))
      }
    }
  }

  return NextResponse.json({
    success: steps.every((item) => item.status !== "failed"),
    mode,
    destructive: true,
    node: { id: node.id, name: node.name, nodeName: node.nodeName },
    temporaryVmid: vmid,
    steps,
  }, { headers: NO_CACHE_HEADERS })
}
