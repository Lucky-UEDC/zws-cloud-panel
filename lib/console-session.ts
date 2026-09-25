import crypto from "node:crypto"
import { NextRequest, NextResponse } from "next/server"
import { computeConsoleMode, type ConsoleFrontendMode, type ConsoleModeResult } from "@/lib/console-mode"
import { CONSOLE_DISABLED_MESSAGE, getConsoleAccess, getConsoleSettings } from "@/lib/console-access"
import { consoleModeForResolvedType, normalizeConsoleType, resolveConsoleType } from "@/lib/console-resolution"
import { prisma } from "@/lib/db"
import { createProxmoxClient } from "@/lib/proxmox"
import { createProxmoxTermProxy, createProxmoxVncProxy, type ProxmoxConsoleTargetKind } from "@/lib/proxmox-vnc"
import { getRedisClient } from "@/lib/redis"

const CONSOLE_SESSION_TTL_SECONDS = 5 * 60
const CONSOLE_RESIZE_TTL_SECONDS = 6 * 60 * 60
const CONSOLE_RENEW_WINDOW_SECONDS = 60

export type ConsoleSessionActor =
  | { type: "client"; customerId: string }
  | { type: "admin"; adminEmail: string }

type JsonErrorOptions = {
  code: string
  error: string
  status: number
  modeData?: ConsoleModeResult
  target?: { kind: ProxmoxConsoleTargetKind; vmid: number; node: string } | null
  diagnostics?: Record<string, unknown>
  validationSteps?: ConsoleValidationStep[]
}

export type ConsoleValidationStep = {
  code: string
  ok: boolean
  message: string
  target?: unknown
  display?: unknown
  transport?: ConsoleFrontendMode | null
}

export function redactConsoleSecret(input: unknown) {
  return String(input || "Unknown error")
    .replace(/PVEAPIToken=[^\s"'<>]+/gi, "PVEAPIToken=[redacted]")
    .replace(/PVEAuthCookie=[^;\s"'<>]+/gi, "PVEAuthCookie=[redacted]")
    .replace(/PVEVNC:[^&\s"'<>]+/gi, "PVEVNC:[redacted]")
    .replace(/ticket["':=\s]+[^"',\s}]+/gi, "ticket=[redacted]")
    .replace(/\btoken(secret)?["':=\s]+[^"',\s}]+/gi, "token=[redacted]")
    .replace(/password["':=\s]+[^"',\s}]+/gi, "password=[redacted]")
}

function validationStep(input: ConsoleValidationStep): ConsoleValidationStep {
  return {
    code: input.code,
    ok: input.ok,
    message: input.message,
    ...(input.target ? { target: input.target } : {}),
    ...(input.display ? { display: input.display } : {}),
    ...(input.transport ? { transport: input.transport } : {}),
  }
}

function validationPayload(steps: ConsoleValidationStep[] | undefined, fallback: ConsoleValidationStep) {
  return { steps: steps?.length ? steps.map(validationStep) : [validationStep(fallback)] }
}

function jsonError({ code, error, status, modeData, target, diagnostics, validationSteps }: JsonErrorOptions) {
  return NextResponse.json({
    ok: false,
    success: false,
    code,
    error,
    message: error,
    state: "Connection failed",
    ...(target ? { target } : {}),
    ...(diagnostics ? { diagnostics } : {}),
    validation: validationPayload(validationSteps, {
      code,
      ok: false,
      message: error,
      target,
      display: modeData?.display as any,
    }),
    ...(modeData ? { mode: modeData.mode, defaultMode: modeData.defaultMode, display: modeData.display, switches: modeData.switches } : {}),
  }, { status })
}

function getWebSocketUrl(request: NextRequest, mode: ConsoleFrontendMode, token: string) {
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host")
  if (!host) throw new Error("Could not determine console websocket host.")
  const proto = request.headers.get("x-forwarded-proto") || request.nextUrl.protocol.replace(":", "")
  const wsProto = proto === "https" ? "wss" : "ws"
  return `${wsProto}://${host}/api/console/proxy/${mode}/${encodeURIComponent(token)}`
}

function serialDeviceFromConfig(config: Record<string, any> | null | undefined): "serial0" | "serial1" | "serial2" | "serial3" | undefined {
  for (const key of ["serial0", "serial1", "serial2", "serial3"] as const) {
    if (typeof config?.[key] === "string" && config[key].trim().split(",")[0]?.toLowerCase() === "socket") return key
  }
  return undefined
}

function consoleUserFromToken(tokenId: string) {
  const owner = String(tokenId || "").split("!")[0]?.trim()
  return owner || "root@pam"
}

function safeDiagnosticError(error: unknown) {
  const item = error as any
  return {
    code: item?.code || null,
    status: item?.status || item?.httpStatus || null,
    message: redactConsoleSecret(item?.message || error),
  }
}

function targetRef(kind: ProxmoxConsoleTargetKind, node: string, vmid: number) {
  return { kind, node, vmid }
}

function consoleInfrastructureStatus(message: string) {
  const text = message.toLowerCase()
  if (text.includes("timed out") || text.includes("timeout")) return 504
  if (text.includes("vncproxy") || text.includes("termproxy") || text.includes("proxmox") || text.includes("ticket") || text.includes("unauthorized") || text.includes("401")) return 502
  return 500
}

function actorSessionKey(actor: ConsoleSessionActor, vpsId: string, mode: ConsoleFrontendMode) {
  const actorPart = actor.type === "admin" ? `admin:${actor.adminEmail}` : `client:${actor.customerId}`
  return `console:active:${actorPart}:${vpsId}:${mode}`
}

function sessionMeta(token: string, ttlSeconds: number) {
  const ttl = Math.max(1, ttlSeconds)
  const now = Date.now()
  const expiresAtMs = now + ttl * 1000
  const renewAfterMs = now + Math.max(1, ttl - CONSOLE_RENEW_WINDOW_SECONDS) * 1000
  return {
    id: token,
    ttlSeconds: ttl,
    expiresAt: new Date(expiresAtMs).toISOString(),
    renewAfterAt: new Date(Math.min(renewAfterMs, expiresAtMs - 1000)).toISOString(),
  }
}

async function resolveConsoleTarget(proxmox: ReturnType<typeof createProxmoxClient>, nodeName: string, vmid: number) {
  const diagnostics: Record<string, unknown> = {
    qemu: { checked: true },
    lxc: { checked: false },
  }

  try {
    const runtime = await proxmox.getVMStatus(nodeName, vmid)
    const config = await proxmox.getVMConfig(nodeName, vmid).catch((error) => {
      diagnostics.qemu = { checked: true, status: runtime?.status || "unknown", configError: safeDiagnosticError(error) }
      return null
    })
    diagnostics.qemu = { checked: true, status: runtime?.status || "unknown", hasConfig: Boolean(config) }
    return { kind: "qemu" as const, runtime, config, diagnostics }
  } catch (error) {
    diagnostics.qemu = { checked: true, error: safeDiagnosticError(error) }
  }

  diagnostics.lxc = { checked: true }
  try {
    const runtime = await proxmox.getLxcStatus(nodeName, vmid)
    const config = await proxmox.getLxcConfig(nodeName, vmid).catch((error) => {
      diagnostics.lxc = { checked: true, status: runtime?.status || "unknown", configError: safeDiagnosticError(error) }
      return null
    })
    diagnostics.lxc = { checked: true, status: runtime?.status || "unknown", hasConfig: Boolean(config) }
    return { kind: "lxc" as const, runtime, config, diagnostics }
  } catch (error) {
    diagnostics.lxc = { checked: true, error: safeDiagnosticError(error) }
  }

  return { kind: null, runtime: null, config: null, diagnostics }
}

async function getReadyRedis() {
  const redis = getRedisClient()
  if (!redis) {
    return { redis: null, error: jsonError({ code: "console_session_store_missing", error: "Console sessions require Redis to be configured.", status: 503 }) }
  }
  await redis.connect().catch(() => undefined)
  if (redis.status !== "ready") {
    return { redis: null, error: jsonError({ code: "console_session_store_unavailable", error: "Console session store is unavailable.", status: 503 }) }
  }
  return { redis, error: null }
}

export async function createConsoleSessionResponse(request: NextRequest, instanceId: string, actor: ConsoleSessionActor) {
  const validationSteps: ConsoleValidationStep[] = []
  const addValidationStep = (step: ConsoleValidationStep) => {
    validationSteps.push(validationStep(step))
  }
  try {
    const body = await request.json().catch(() => ({}))
    const requestedMode = String(body?.mode || "").toLowerCase() === "vnc"
      ? "vnc"
      : String(body?.mode || "").toLowerCase() === "serial"
        ? "serial"
        : null
    const forceRenew = body?.renew === true || body?.forceRenew === true
    const redisResult = await getReadyRedis()
    if (redisResult.error || !redisResult.redis) {
      addValidationStep({ code: "console_session_store", ok: false, message: "Console session store is unavailable." })
      return jsonError({
        code: "console_session_store_unavailable",
        error: "Console session store is unavailable.",
        status: 503,
        validationSteps,
      })
    }
    const redis = redisResult.redis

    const vps = await prisma.vpsInstance.findFirst({
      where: {
        OR: [{ id: instanceId }, { orderId: instanceId }],
        ...(actor.type === "client" ? { customerId: actor.customerId } : {}),
        deletedAt: null,
        status: { not: "DELETED" },
        order: {
          deletedAt: null,
          status: { not: "DELETED" },
        },
      },
      include: {
        proxmoxNode: true,
        product: { select: { metadata: true } },
        operatingSystem: { select: { name: true, slug: true, osType: true, category: true, osFamily: true, osVersion: true, consoleType: true, proxmoxTemplateName: true, proxmoxConfig: true } },
        order: {
          select: {
            proxmoxNode: true,
            vmId: true,
            deletedAt: true,
            status: true,
            osName: true,
            operatingSystem: { select: { name: true, slug: true, osType: true, category: true, osFamily: true, osVersion: true, consoleType: true, proxmoxTemplateName: true, proxmoxConfig: true } },
          },
        },
      },
    })

    if (!vps?.order || !vps.vmid) {
      return jsonError({ code: "instance_not_found", error: "Instance not found.", status: 404, validationSteps })
    }
    addValidationStep({ code: "managed_instance", ok: true, message: "Managed VPS row found.", target: { vpsId: vps.id, vmid: vps.vmid } })
    addValidationStep({ code: "vmid_valid", ok: Number.isInteger(vps.vmid) && vps.vmid > 0, message: `VMID ${vps.vmid} is valid.`, target: { vmid: vps.vmid } })

    const blockedStatuses = new Set(["DELETED", "CANCELLED", "EXPIRED", "TERMINATED"])
    if (blockedStatuses.has(String(vps.status || "").toUpperCase())) {
      return jsonError({ code: "console_instance_state_blocked", error: "Console access is unavailable for this instance state.", status: 409, validationSteps })
    }

    if (actor.type === "client") {
      const overdueRenewal = await prisma.invoice.findFirst({
        where: {
          customerId: actor.customerId,
          deletedAt: null,
          OR: [
            { status: "overdue" },
            { status: "pending", dueDate: { lt: new Date() } },
          ],
          metadata: { path: ["vpsInstanceId"], equals: vps.id },
        },
        select: { id: true },
      }).catch(() => null)

      if (overdueRenewal) {
        return jsonError({ code: "console_renewal_required", error: "Renewal is required before console access is available.", status: 402 })
      }
    }

    const nodeConfig = vps.proxmoxNode || await prisma.proxmoxNode.findFirst({
      where: { OR: [{ nodeName: vps.order.proxmoxNode || "" }, { id: vps.order.proxmoxNode || "" }] },
    })
    if (!nodeConfig) {
      return jsonError({ code: "console_node_unreachable", error: "Console node configuration could not be found.", status: 500, validationSteps })
    }
    addValidationStep({ code: "node_config", ok: true, message: "Console node configuration found.", target: { nodeId: nodeConfig.id, node: nodeConfig.nodeName } })

    const os = vps.operatingSystem || vps.order.operatingSystem
    const settings = await getConsoleSettings().catch(() => null)
    const storedConsoleType = normalizeConsoleType((vps as any).consoleType)
    const detected = resolveConsoleType({ template: os ? { ...os, name: os.name || vps.order.osName } : { name: vps.order.osName }, settings })
    const resolvedConsoleType = storedConsoleType === "auto" ? detected.consoleType : storedConsoleType
    const resolvedModeData = consoleModeForResolvedType({ consoleType: resolvedConsoleType })

    const proxmox = createProxmoxClient(nodeConfig.host, nodeConfig.tokenId, nodeConfig.tokenSecret, {
      allowInsecureTls: nodeConfig.allowInsecureTls,
    })
    const target = await resolveConsoleTarget(proxmox, nodeConfig.nodeName, vps.vmid)
    if (!target.kind || !target.runtime) {
      return jsonError({
        code: "console_target_not_found",
        error: "Console target was not found as a QEMU VM or LXC container on this node.",
        status: 404,
        modeData: resolvedModeData,
        diagnostics: target.diagnostics,
        validationSteps: [
          ...validationSteps,
          validationStep({ code: "proxmox_target", ok: false, message: "VM was not found on the configured Proxmox node.", target: { node: nodeConfig.nodeName, vmid: vps.vmid } }),
        ],
      })
    }
    addValidationStep({ code: "proxmox_target", ok: true, message: `${target.kind.toUpperCase()} target exists on Proxmox.`, target: targetRef(target.kind, nodeConfig.nodeName, vps.vmid) })

    const vmConfig = target.config
    const runtimeModeData = computeConsoleMode({
      targetKind: target.kind,
      vmConfig,
      osName: os?.name || vps.order.osName,
      osSlug: os?.slug,
      osType: os?.osType || os?.osFamily,
      osCategory: os?.category,
      templateName: os?.proxmoxTemplateName,
      templateConfig: os?.proxmoxConfig,
    })
    const modeData = runtimeModeData.mode === "unknown" && !vmConfig ? resolvedModeData : runtimeModeData
    const diagnostics = {
      ...target.diagnostics,
      detection: {
        targetKind: target.kind,
        runtimeStatus: target.runtime?.status || "unknown",
        osFamily: detected.vmOsFamily,
        storedConsoleType,
        resolvedConsoleType,
        selectedDefault: modeData.defaultMode,
        display: modeData.display,
        switches: modeData.switches,
      },
    }
    addValidationStep({
      code: "qm_config",
      ok: Boolean(vmConfig),
      message: vmConfig ? "VM display configuration was read from Proxmox." : "VM display configuration was unavailable; using stored console metadata.",
      target: targetRef(target.kind, nodeConfig.nodeName, vps.vmid),
      display: modeData.display as any,
    })
    addValidationStep({
      code: "display_device",
      ok: modeData.mode !== "unknown",
      message: modeData.reason,
      target: targetRef(target.kind, nodeConfig.nodeName, vps.vmid),
      display: modeData.display as any,
    })

    if (modeData.mode === "unknown") {
      const spiceOnly = Boolean(modeData.display?.spice)
      return jsonError({
        code: spiceOnly ? "spice_console_unsupported" : "console_mode_unknown",
        error: spiceOnly
          ? "This guest appears to be SPICE-only. Browser SPICE consoles are not supported by this panel; enable a graphical VGA adapter or serial console."
          : "No supported console path was detected for this instance.",
        status: 409,
        modeData,
        target: targetRef(target.kind, nodeConfig.nodeName, vps.vmid),
        diagnostics,
        validationSteps,
      })
    }

    const consoleAccess = await getConsoleAccess(vps, modeData)
    if (!consoleAccess.enabled) {
      return jsonError({ code: "console_disabled", error: consoleAccess.reason || CONSOLE_DISABLED_MESSAGE, status: 403, modeData, target: targetRef(target.kind, nodeConfig.nodeName, vps.vmid), diagnostics, validationSteps })
    }
    const availableModes: ConsoleFrontendMode[] = [
      ...(consoleAccess.graphical ? ["vnc" as const] : []),
      ...(consoleAccess.terminal ? ["serial" as const] : []),
    ]
    let selectedMode = requestedMode && availableModes.includes(requestedMode)
      ? requestedMode
      : availableModes.includes(modeData.defaultMode)
        ? modeData.defaultMode
        : availableModes[0]
    if (!selectedMode) {
      return jsonError({ code: "console_mode_unavailable", error: "No enabled console transport is available for this instance.", status: 403, modeData, target: targetRef(target.kind, nodeConfig.nodeName, vps.vmid), diagnostics, validationSteps })
    }
    addValidationStep({ code: "transport_selected", ok: true, message: `${selectedMode} transport selected.`, target: targetRef(target.kind, nodeConfig.nodeName, vps.vmid), display: modeData.display as any, transport: selectedMode })
    if (requestedMode && !availableModes.includes(requestedMode)) {
      return jsonError({ code: "console_mode_denied", error: "Requested console mode is not enabled for this instance.", status: 403, modeData, target: targetRef(target.kind, nodeConfig.nodeName, vps.vmid), diagnostics, validationSteps })
    }
    if (selectedMode === "serial" && !consoleAccess.terminal) {
      return jsonError({ code: "termproxy_permission_denied", error: "Serial console access is disabled for this instance.", status: 403, modeData, target: targetRef(target.kind, nodeConfig.nodeName, vps.vmid), diagnostics, validationSteps })
    }
    if (selectedMode === "vnc" && !consoleAccess.graphical) {
      return jsonError({ code: "vncproxy_permission_denied", error: "Graphical console access is disabled for this instance.", status: 403, modeData, target: targetRef(target.kind, nodeConfig.nodeName, vps.vmid), diagnostics, validationSteps })
    }
    const runtimeStatus = String(target.runtime.status || "").toLowerCase()
    if (runtimeStatus !== "running") {
      return jsonError({
        code: "vm_not_running",
        error: `Server is ${runtimeStatus || "not running"}. Start the VM before opening console.`,
        status: 409,
        modeData,
        target: targetRef(target.kind, nodeConfig.nodeName, vps.vmid),
        diagnostics,
        validationSteps: [
          ...validationSteps,
          validationStep({ code: "vm_running", ok: false, message: `VM runtime status is ${runtimeStatus || "unknown"}.`, target: targetRef(target.kind, nodeConfig.nodeName, vps.vmid), transport: selectedMode }),
        ],
      })
    }
    addValidationStep({ code: "vm_running", ok: true, message: "VM runtime status is running.", target: targetRef(target.kind, nodeConfig.nodeName, vps.vmid), transport: selectedMode })
    const consoleNodeConfig = nodeConfig
    const consoleVps = vps
    const consoleTargetKind = target.kind

    const baseSession = {
      customerId: vps.customerId,
      ...(actor.type === "admin" ? { actorType: "admin" as const, adminEmail: actor.adminEmail } : { actorType: "client" as const }),
      vpsId: vps.id,
      proxmoxNodeId: nodeConfig.id,
      nodeName: nodeConfig.nodeName,
      vmid: vps.vmid,
      targetKind: target.kind,
      mode: selectedMode,
      createdAt: new Date().toISOString(),
    }

    const response: Record<string, any> = {
      ok: true,
      success: true,
      state: "Generating ticket",
      mode: selectedMode,
      defaultMode: modeData.defaultMode,
      availableModes,
      consoleType: selectedMode === "vnc" ? "novnc" : "xtermjs",
      target: targetRef(target.kind, nodeConfig.nodeName, vps.vmid),
      display: modeData.display,
      switches: modeData.switches,
      diagnostics,
      validation: {
        steps: validationSteps,
        successRequires: selectedMode === "vnc" ? "vnc_framebuffer" : "serial_output",
        sessionTtlSeconds: CONSOLE_SESSION_TTL_SECONDS,
      },
      vm: {
        id: vps.id,
        name: vps.name,
        status: target.runtime.status || "unknown",
      },
    }

    const activeKey = actorSessionKey(actor, vps.id, selectedMode)
    if (!forceRenew && process.env.CONSOLE_SESSION_REUSE_ENABLED === "1") {
      const activeToken = await redis.get(activeKey).catch(() => null)
      const activeSessionKey = activeToken ? `console:${selectedMode}:${activeToken}` : null
      const [activeRaw, activeTtl] = activeSessionKey
        ? await Promise.all([
            redis.get(activeSessionKey).catch(() => null),
            redis.ttl(activeSessionKey).catch(() => -2),
          ])
        : [null, -2]
      if (activeToken && activeRaw && activeTtl > CONSOLE_RENEW_WINDOW_SECONDS) {
        try {
          const session = JSON.parse(activeRaw)
          if (
            session?.vpsId === vps.id &&
            session?.proxmoxNodeId === nodeConfig.id &&
            session?.mode === selectedMode &&
            (selectedMode === "vnc"
              ? session.vncTicket && session.vncPort
              : session.termTicket && session.termPort && session.resizeToken)
          ) {
            await redis.set(activeKey, activeToken, "EX", activeTtl).catch(() => null)
            response.state = "Reusing active ticket"
            response.session = sessionMeta(activeToken, activeTtl)
            if (selectedMode === "vnc") {
              response.vnc = {
                websocketUrl: getWebSocketUrl(request, "vnc", activeToken),
                password: session.vncTicket,
              }
            } else {
              response.serial = {
                websocketUrl: getWebSocketUrl(request, "serial", activeToken),
                resizeToken: session.resizeToken,
              }
            }
            return NextResponse.json(response)
          }
        } catch {
          // Corrupt session payloads are ignored and replaced below.
        }
      }
    }

    async function mintVncTicket(attempt: "native_novnc" | "regenerated_websocket" | "fresh_vnc_ticket") {
      const token = crypto.randomBytes(32).toString("base64url")
      const vncTicket = await createProxmoxVncProxy({
        host: consoleNodeConfig.host,
        node: consoleNodeConfig.nodeName,
        vmid: consoleVps.vmid,
        targetKind: consoleTargetKind,
        tokenId: consoleNodeConfig.tokenId,
        tokenSecret: consoleNodeConfig.tokenSecret,
        allowInsecureTls: consoleNodeConfig.allowInsecureTls,
      }).catch((error) => {
        throw new Error(`vncproxy failed: ${redactConsoleSecret(error?.message || error)}`)
      })
      addValidationStep({ code: "vncproxy_ticket", ok: true, message: "Proxmox vncproxy returned a usable ticket.", target: targetRef(consoleTargetKind, consoleNodeConfig.nodeName, consoleVps.vmid), transport: "vnc" })
      await redis.set(`console:vnc:${token}`, JSON.stringify({
        ...baseSession,
        mode: "vnc",
        vncTicket: vncTicket.ticket,
        vncPort: vncTicket.port,
        fallbackAttempt: attempt,
      }), "EX", CONSOLE_SESSION_TTL_SECONDS)
      await redis.set(actorSessionKey(actor, consoleVps.id, "vnc"), token, "EX", CONSOLE_SESSION_TTL_SECONDS).catch(() => null)
      response.session = sessionMeta(token, CONSOLE_SESSION_TTL_SECONDS)
      response.vnc = {
        websocketUrl: getWebSocketUrl(request, "vnc", token),
        password: vncTicket.ticket,
      }
      addValidationStep({ code: "websocket_generated", ok: true, message: "Panel VNC websocket URL generated.", target: targetRef(consoleTargetKind, consoleNodeConfig.nodeName, consoleVps.vmid), transport: "vnc" })
      response.validation = { ...(response.validation || {}), steps: validationSteps }
      response.mode = "vnc"
      response.consoleType = "novnc"
      response.state = attempt === "native_novnc" ? "Ticket ready" : "Ticket regenerated"
      response.fallback = { selected: attempt }
    }

    async function mintSerialTicket(attempt: "serial_console" | "node_reconnect") {
      const token = crypto.randomBytes(32).toString("base64url")
      const serial = serialDeviceFromConfig(vmConfig) || "serial0"
      const resizeToken = crypto.randomBytes(32).toString("base64url")
      const termTicket = await createProxmoxTermProxy({
        host: consoleNodeConfig.host,
        node: consoleNodeConfig.nodeName,
        vmid: consoleVps.vmid,
        targetKind: consoleTargetKind,
        tokenId: consoleNodeConfig.tokenId,
        tokenSecret: consoleNodeConfig.tokenSecret,
        serial,
        allowInsecureTls: consoleNodeConfig.allowInsecureTls,
      }).catch((error) => {
        throw new Error(`termproxy failed: ${redactConsoleSecret(error?.message || error)}`)
      })
      addValidationStep({ code: "termproxy_ticket", ok: true, message: "Proxmox termproxy returned a usable ticket.", target: targetRef(consoleTargetKind, consoleNodeConfig.nodeName, consoleVps.vmid), transport: "serial" })
      const termUser = termTicket.user || consoleUserFromToken(consoleNodeConfig.tokenId)
      const serialSession = { ...baseSession, mode: "serial", termTicket: termTicket.ticket, termPort: termTicket.port, termUser, serial, resizeToken, fallbackAttempt: attempt }
      await redis.set(`console:serial:${token}`, JSON.stringify(serialSession), "EX", CONSOLE_SESSION_TTL_SECONDS)
      await redis.set(`console:resize:${resizeToken}`, JSON.stringify(serialSession), "EX", CONSOLE_RESIZE_TTL_SECONDS)
      await redis.set(actorSessionKey(actor, consoleVps.id, "serial"), token, "EX", CONSOLE_SESSION_TTL_SECONDS).catch(() => null)
      response.session = sessionMeta(token, CONSOLE_SESSION_TTL_SECONDS)
      response.serial = { websocketUrl: getWebSocketUrl(request, "serial", token), resizeToken }
      addValidationStep({ code: "websocket_generated", ok: true, message: "Panel serial websocket URL generated.", target: targetRef(consoleTargetKind, consoleNodeConfig.nodeName, consoleVps.vmid), transport: "serial" })
      response.validation = { ...(response.validation || {}), steps: validationSteps }
      delete response.vnc
      selectedMode = "serial"
      response.mode = "serial"
      response.consoleType = "xtermjs"
      response.state = attempt === "node_reconnect" ? "Node reconnected with serial ticket" : "Serial fallback ticket ready"
      response.fallback = { selected: attempt }
    }

    if (selectedMode === "vnc") {
      const failures: Array<{ method: string; error: ReturnType<typeof safeDiagnosticError> }> = []
      for (const attempt of ["native_novnc", "regenerated_websocket", "fresh_vnc_ticket"] as const) {
        try {
          await mintVncTicket(attempt)
          response.diagnostics = { ...diagnostics, fallbackFailures: failures }
          return NextResponse.json(response)
        } catch (error) {
          failures.push({ method: attempt, error: safeDiagnosticError(error) })
        }
      }
      if (availableModes.includes("serial")) {
        try {
          await mintSerialTicket("serial_console")
          response.diagnostics = { ...diagnostics, fallbackFailures: failures }
          return NextResponse.json(response)
        } catch (error) {
          failures.push({ method: "serial_console", error: safeDiagnosticError(error) })
        }
        try {
          const refreshed = await resolveConsoleTarget(proxmox, consoleNodeConfig.nodeName, consoleVps.vmid)
          if (refreshed.kind && refreshed.runtime) {
            await mintSerialTicket("node_reconnect")
            response.diagnostics = { ...diagnostics, reconnect: refreshed.diagnostics, fallbackFailures: failures }
            return NextResponse.json(response)
          }
        } catch (error) {
          failures.push({ method: "node_reconnect", error: safeDiagnosticError(error) })
        }
      }
      throw new Error(`vncproxy failed after all console fallbacks: ${failures.map((failure) => `${failure.method}:${failure.error.message}`).join("; ")}`)
    } else {
      try {
        await mintSerialTicket("serial_console")
      } catch (error) {
        try {
          const refreshed = await resolveConsoleTarget(proxmox, consoleNodeConfig.nodeName, consoleVps.vmid)
          if (!refreshed.kind || !refreshed.runtime) throw error
          await mintSerialTicket("node_reconnect")
          response.diagnostics = { ...diagnostics, reconnect: refreshed.diagnostics, fallbackFailures: [{ method: "serial_console", error: safeDiagnosticError(error) }] }
          return NextResponse.json(response)
        } catch {
          throw error
        }
      }
    }

    response.validation = { ...(response.validation || {}), steps: validationSteps }
    return NextResponse.json(response)
  } catch (error: any) {
    const message = redactConsoleSecret(error?.message || "Could not create console session.")
    const code = /^vncproxy failed/i.test(message)
      ? "vncproxy_failed"
      : /^termproxy failed/i.test(message)
        ? "termproxy_failed"
        : /websocket/i.test(message)
          ? "websocket_timeout"
          : "console_session_failed"
    return jsonError({ code, error: message, status: consoleInfrastructureStatus(message), validationSteps })
  }
}
