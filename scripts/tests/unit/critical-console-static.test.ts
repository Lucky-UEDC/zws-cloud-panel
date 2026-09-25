import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
const read = (path: string) => readFileSync(`${root}/${path}`, "utf8")

test("Docker worker owns the console proxy and exposes health", () => {
  const compose = read("docker-compose.yml")
  const nginx = read("config/nginx/docker.conf")
  const worker = read("workers/zws-worker.ts")
  const supervisor = read("workers/process-supervisor.ts")

  assert.match(compose, /command: \["worker"\]/)
  assert.match(compose, /WORKER_HEALTH_PORT/)
  assert.match(nginx, /server worker:3001/)
  assert.match(worker, /CONSOLE_PROXY_EMBEDDED === "1"/)
  assert.match(worker, /scripts\/vnc-proxy-server\.ts/)
  assert.match(supervisor, /\/api\/health/)
})

test("production installer is Docker-first", () => {
  const installer = read("installer/install.sh")
  const compose = read("docker-compose.yml")

  assert.match(installer, /docker compose/)
  assert.match(installer, /cloudflared/)
  assert.doesNotMatch(installer, /pm2/i)
  assert.match(compose, /service_completed_successfully/)
  assert.match(compose, /command: \["migrate"\]/)
})

test("smart console does not mark VNC ready before framebuffer visibility", () => {
  const smartConsole = read("components/console/smart-console.tsx")
  assert.match(smartConsole, /VNC transport connected/)
  assert.match(smartConsole, /Awaiting framebuffer/)
  assert.match(smartConsole, /VNC framebuffer timeout/)
  assert.match(smartConsole, /!displayReady && !error/)
  assert.match(smartConsole, /Connecting to node/)
  assert.match(smartConsole, /Download screenshot/)
  assert.match(smartConsole, /5_000/)
  assert.match(smartConsole, /forceRenew: true/)
})

test("console overview routes share the actor-aware service", () => {
  const client = read("app/api/client/vps/[id]/console/overview/route.ts")
  const admin = read("app/api/admin/vms/[id]/console/overview/route.ts")
  const service = read("lib/console-overview.ts")
  assert.match(client, /getConsoleOverview/)
  assert.match(admin, /canAccessAdminApi/)
  assert.match(service, /availableModes/)
  assert.match(service, /osFamily !== "windows"/)
})

test("admin node pages expose connected count and remove disk/storage bars", () => {
  const listPage = read("app/admin/compute-nodes/page.tsx")
  const detailPage = read("app/admin/compute-nodes/[id]/page.tsx")
  assert.match(listPage, /Connected Nodes/)
  assert.match(listPage, /isConnectedNodeStatus/)
  assert.doesNotMatch(detailPage, /title="Disk Usage"/)
  assert.doesNotMatch(detailPage, /Storage free/)
  assert.doesNotMatch(detailPage, /<Usage value=\{pool\?\.usagePercent/)
})

test("console session API returns validation steps", () => {
  const session = read("lib/console-session.ts")
  assert.match(session, /CONSOLE_SESSION_REUSE_ENABLED === "1"/)
  assert.match(session, /validation: validationPayload/)
  assert.match(session, /code: "qm_config"/)
  assert.match(session, /code: "display_device"/)
  assert.match(session, /code: "vm_running"/)
  assert.match(session, /code: "websocket_generated"/)
})
