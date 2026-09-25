import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const requiredApps = ["zws-web", "zws-whatsapp", "zws-worker"]

async function command(name: string, args: string[]) {
  const { stdout, stderr } = await execFileAsync(name, args, { timeout: 30_000, maxBuffer: 5_000_000 })
  return `${stdout}${stderr}`.trim()
}

async function check(label: string, task: () => Promise<void>) {
  await task()
  console.log(`[qa] ok: ${label}`)
}

await check("PM2 app ownership", async () => {
  const apps = JSON.parse(await command("pm2", ["jlist"]) || "[]")
  const names = apps.map((app: any) => app.name).filter((name: string) => name.startsWith("zws-"))
  const missing = requiredApps.filter((name) => !names.includes(name))
  const extras = names.filter((name: string) => !requiredApps.includes(name))
  if (missing.length || extras.length) throw new Error(`PM2 mismatch: missing=${missing.join(",")} extras=${extras.join(",")}`)
})

await check("health endpoint", async () => {
  const url = process.env.BASE_URL || "http://127.0.0.1:3000/api/health"
  const response = await fetch(url, { cache: "no-store" })
  if (!response.ok) throw new Error(`${url} returned ${response.status}`)
})

await check("no tracked extra shell scripts", async () => {
  const files = (await command("git", ["ls-files", "*.sh"])).split(/\r?\n/).filter(Boolean)
  const extra = files.filter((file) => file !== "install.sh" && file !== "update.sh")
  if (extra.length) throw new Error(`extra shell scripts: ${extra.join(", ")}`)
})
