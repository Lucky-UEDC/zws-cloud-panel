import "dotenv/config"
import { runSupervisor } from "./process-supervisor"

const node = process.execPath
const tsx = ["--import", "tsx"]
const lightChildHeap = { NODE_OPTIONS: "--max-old-space-size=256 --max-semi-space-size=8" }
const optionalCloudflare = process.env.CLOUDFLARE_TUNNEL_ENABLED === "1" || process.env.CF_TUNNEL_TOKEN
const embeddedConsoleProxy = process.env.CONSOLE_PROXY_EMBEDDED === "1"

runSupervisor("zws-worker", [
  { name: "provision-worker", command: node, args: [...tsx, "scripts/provision-worker.ts"], restartDelayMs: 5_000 },
  { name: "payment-reconcile-worker", command: node, args: [...tsx, "scripts/payment-reconcile-worker.ts"], restartDelayMs: 15_000 },
  { name: "payment-health-worker", command: node, args: [...tsx, "scripts/payment-health-worker.ts"], restartDelayMs: 30_000 },
  { name: "payment-outbox-worker", command: node, args: [...tsx, "scripts/payment-outbox-worker.ts"], restartDelayMs: 5_000 },
  { name: "payment-retry-worker", command: node, args: [...tsx, "scripts/payment-retry-worker.ts"], restartDelayMs: 15_000 },
  { name: "node-telemetry-worker", command: node, args: [...tsx, "scripts/node-telemetry-worker.ts"], restartDelayMs: 30_000 },
  { name: "vm-telemetry-worker", command: node, args: [...tsx, "scripts/vm-telemetry-worker.ts"], restartDelayMs: 30_000 },
  { name: "database-first-proxmox-sync-worker", command: node, args: [...tsx, "scripts/database-first-proxmox-sync-worker.ts"], restartDelayMs: 30_000, env: lightChildHeap },
  { name: "proxmox-event-watcher", command: node, args: [...tsx, "scripts/proxmox-event-watcher.ts"], restartDelayMs: 5_000, env: lightChildHeap },
  { name: "vm-action-worker", command: node, args: [...tsx, "scripts/vm-action-worker.ts"], restartDelayMs: 5_000, env: lightChildHeap },
  { name: "live-bandwidth-worker", command: node, args: [...tsx, "scripts/live-bandwidth-worker.ts"], restartDelayMs: 5_000 },
  { name: "vm-network-validation-worker", command: node, args: [...tsx, "scripts/vm-network-validation-worker.ts"], restartDelayMs: 30_000, env: lightChildHeap },
  { name: "vm-deletion-worker", command: node, args: [...tsx, "scripts/vm-deletion-worker.ts"], restartDelayMs: 30_000, env: lightChildHeap },
  { name: "vm-duplicate-scanner", command: node, args: [...tsx, "scripts/vm-duplicate-scanner.ts"], restartDelayMs: 30_000, env: lightChildHeap },
  { name: "whatsapp-worker", command: node, args: [...tsx, "scripts/whatsapp-worker.ts"], restartDelayMs: 5_000 },
  ...(embeddedConsoleProxy
    ? [{ name: "vnc-proxy", command: node, args: [...tsx, "scripts/vnc-proxy-server.ts"], restartDelayMs: 5_000, env: lightChildHeap }]
    : []),
  ...(optionalCloudflare
    ? [{
        name: "cloudflared-tunnel",
        command: "cloudflared",
        args: process.env.CF_TUNNEL_TOKEN
          ? ["tunnel", "--no-autoupdate", "run", "--token", process.env.CF_TUNNEL_TOKEN]
          : ["tunnel", "--config", process.env.CLOUDFLARED_CONFIG || "config/cloudflared/config.yml", "run"],
        restartDelayMs: 15_000,
        optional: true,
      }]
    : []),
])
