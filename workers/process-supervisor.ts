import { spawn, type ChildProcess } from "node:child_process"
import fs from "node:fs"
import http from "node:http"
import net from "node:net"
import path from "node:path"

type ChildSpec = {
  name: string
  command: string
  args: string[]
  env?: Record<string, string>
  restartDelayMs?: number
  optional?: boolean
  healthyWhenCleanlyExited?: boolean
}

type RunningChild = ChildSpec & {
  child?: ChildProcess
  restarts: number
  stopping: boolean
  lastExitCode?: number | null
  lastExitedAt?: string | null
  nextStartAt?: string | null
}

const logDir = process.env.ZWS_LOG_DIR || path.join(process.cwd(), "logs")
fs.mkdirSync(logDir, { recursive: true })

function log(message: string, metadata: Record<string, unknown> = {}) {
  console.info(`[supervisor] ${message}`, metadata)
}

function logFile(name: string, stream: "out" | "error") {
  return fs.createWriteStream(path.join(logDir, `${name}.${stream === "out" ? "log" : "error.log"}`), { flags: "a" })
}

function tcpCheck(rawUrl: string, defaultPort: number, timeoutMs = 1200) {
  return new Promise<{ ok: boolean; host: string | null; port: number | null; error?: string }>((resolve) => {
    if (!rawUrl) return resolve({ ok: false, host: null, port: null, error: "not_configured" })
    let url: URL
    try {
      url = new URL(rawUrl)
    } catch (error: any) {
      return resolve({ ok: false, host: null, port: null, error: error?.message || "invalid_url" })
    }
    const host = url.hostname
    const port = Number(url.port || defaultPort)
    const socket = net.createConnection({ host, port })
    const done = (ok: boolean, error?: string) => {
      socket.destroy()
      resolve({ ok, host, port, ...(error ? { error } : {}) })
    }
    socket.setTimeout(timeoutMs)
    socket.once("connect", () => done(true))
    socket.once("timeout", () => done(false, "timeout"))
    socket.once("error", (error) => done(false, error.message))
  })
}

function startHealthServer(groupName: string, children: RunningChild[]) {
  const port = Number(process.env.ZWS_HEALTH_PORT || "")
  if (!Number.isFinite(port) || port <= 0) return

  const server = http.createServer(async (req, res) => {
    if (req.url && !req.url.startsWith("/api/health")) {
      res.writeHead(404, { "content-type": "application/json" })
      res.end(JSON.stringify({ ok: false, error: "not_found" }))
      return
    }

    const childStatuses = children.map((child) => ({
      name: child.name,
      optional: Boolean(child.optional),
      pid: child.child?.pid || null,
      running: Boolean(child.child && !child.child.killed),
      restarts: child.restarts,
      lastExitCode: child.lastExitCode ?? null,
      lastExitedAt: child.lastExitedAt ?? null,
      nextStartAt: child.nextStartAt ?? null,
      healthyWhenCleanlyExited: Boolean(child.healthyWhenCleanlyExited),
    }))
    const requiredChildrenOk = childStatuses.every(
      (child) => child.optional || child.running || (child.healthyWhenCleanlyExited && child.lastExitCode === 0),
    )
    const [database, redis] = await Promise.all([
      tcpCheck(process.env.DATABASE_URL || "", 5432),
      tcpCheck(process.env.REDIS_URL || "", 6379),
    ])
    const healthy = requiredChildrenOk && database.ok && redis.ok
    res.writeHead(healthy ? 200 : 503, { "content-type": "application/json", "cache-control": "no-store" })
    res.end(JSON.stringify({
      status: healthy ? "ok" : "degraded",
      groupName,
      checkedAt: new Date().toISOString(),
      database,
      redis,
      children: childStatuses,
    }))
  })

  server.listen(port, "0.0.0.0", () => {
    log("health server listening", { groupName, port })
  })
}

export function runSupervisor(groupName: string, specs: ChildSpec[]) {
  const children = specs.map<RunningChild>((spec) => ({ ...spec, restarts: 0, stopping: false }))
  let shuttingDown = false

  function start(running: RunningChild) {
    if (shuttingDown || running.stopping) return

    const stdout = logFile(running.name, "out")
    const stderr = logFile(running.name, "error")
    const child = spawn(running.command, running.args, {
      cwd: process.cwd(),
      env: { ...process.env, ...(running.env || {}) },
      stdio: ["ignore", "pipe", "pipe"],
    })

    running.child = child
    running.nextStartAt = null
    running.restarts += 1
    log("child started", { groupName, name: running.name, pid: child.pid, restarts: running.restarts })

    child.stdout?.pipe(stdout)
    child.stderr?.pipe(stderr)

    child.on("exit", (code, signal) => {
      stdout.end()
      stderr.end()
      running.child = undefined
      running.lastExitCode = code
      running.lastExitedAt = new Date().toISOString()
      log("child exited", { groupName, name: running.name, code, signal })
      if (shuttingDown || running.stopping) return
      const cleanPeriodicExit = code === 0 && running.healthyWhenCleanlyExited
      const delay = cleanPeriodicExit
        ? Number(running.restartDelayMs || 5_000)
        : Math.min(
            Number(running.restartDelayMs || 5_000) * Math.max(1, Math.min(running.restarts, 12)),
            60_000,
          )
      running.nextStartAt = new Date(Date.now() + delay).toISOString()
      setTimeout(() => start(running), delay)
    })

    child.on("error", (error) => {
      log("child start failed", { groupName, name: running.name, error: error.message })
      if (running.optional) return
      process.exitCode = 1
    })
  }

  function shutdown(signal: NodeJS.Signals) {
    shuttingDown = true
    log("shutdown requested", { groupName, signal })
    for (const running of children) {
      running.stopping = true
      running.child?.kill(signal)
    }
    setTimeout(() => process.exit(0), 10_000).unref()
  }

  process.once("SIGINT", () => shutdown("SIGINT"))
  process.once("SIGTERM", () => shutdown("SIGTERM"))

  for (const child of children) start(child)
  startHealthServer(groupName, children)

  setInterval(() => {
    log("heartbeat", {
      groupName,
      children: children.map((child) => ({
        name: child.name,
        pid: child.child?.pid || null,
        restarts: child.restarts,
      })),
    })
  }, Number(process.env.SUPERVISOR_HEARTBEAT_MS || 60_000)).unref()
}
