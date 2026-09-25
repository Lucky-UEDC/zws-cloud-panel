import path from "node:path"
import { spawnSync } from "node:child_process"
import { pathToFileURL } from "node:url"

process.env.NODE_ENV ||= "production"
process.env.HOSTNAME ||= "127.0.0.1"
process.env.PORT ||= "3000"
process.env.NEXT_TELEMETRY_DISABLED ||= "1"
process.env.ZWS_BOOT_AUTHORITY ||= "pm2"

const appDir = process.env.APP_DIR || process.cwd()
const guard = spawnSync(process.execPath, ["--import", "tsx", path.join(appDir, "scripts", "startup-next-build-guard.ts")], {
  cwd: appDir,
  env: { ...process.env, REQUIRE_STANDALONE_STATIC: "1" },
  stdio: "inherit",
})
if (guard.status !== 0) {
  process.exit(guard.status || 1)
}
const serverPath = path.join(appDir, ".next", "standalone", "server.js")
await import(pathToFileURL(serverPath).href)
