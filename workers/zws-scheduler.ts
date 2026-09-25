import "dotenv/config"
import { runSupervisor } from "./process-supervisor"

const node = process.execPath
const tsx = ["--import", "tsx"]

runSupervisor("zws-scheduler", [
  { name: "renewal-worker", command: node, args: [...tsx, "scripts/renewal-worker.ts"], restartDelayMs: 15_000 },
  { name: "backup-billing-recurrence", command: node, args: [...tsx, "scripts/backup-billing-recurrence.ts"], restartDelayMs: 60_000 },
  { name: "backup-scheduler", command: node, args: [...tsx, "scripts/backup-scheduler.ts"], restartDelayMs: 60_000 },
  { name: "vm-backup-scheduler", command: node, args: [...tsx, "scripts/vm-backup-scheduler.ts"], restartDelayMs: 60_000 },
  { name: "exchange-rate-scheduler", command: node, args: [...tsx, "scripts/exchange-rate-scheduler.ts"], restartDelayMs: 60_000 },
  { name: "invoice-cleanup", command: node, args: [...tsx, "scripts/cleanup-unpaid-invoices.ts"], restartDelayMs: 6 * 60 * 60_000, healthyWhenCleanlyExited: true },
])
