import { runProxmoxDiagnostics } from "@/lib/proxmox"

type Args = {
  host?: string
  node?: string
  tokenId?: string
  tokenSecret?: string
  insecure?: boolean
}

function parseArgs(argv: string[]): Args {
  const args: Args = {}
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index]
    const value = argv[index + 1]
    if (!key.startsWith("--")) continue
    index += 1
    if (key === "--host") args.host = value
    if (key === "--node") args.node = value
    if (key === "--token-id") args.tokenId = value
    if (key === "--token-secret") args.tokenSecret = value
    if (key === "--insecure") args.insecure = value === "true" || value === "1" || value === "yes"
  }
  return args
}

function usage() {
  console.error("Usage: pnpm tsx scripts/debug-proxmox-connect.ts --host <host> --node <node> --token-id <user@realm!token> --token-secret <secret> --insecure true|false")
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.host || !args.node || !args.tokenId || !args.tokenSecret) {
    usage()
    process.exitCode = 1
    return
  }

  const result = await runProxmoxDiagnostics({
    host: args.host,
    nodeName: args.node,
    tokenId: args.tokenId,
    tokenSecret: args.tokenSecret,
    allowInsecureTls: Boolean(args.insecure),
  })

  console.log(`Diagnostic ${result.ok ? "PASS" : "FAIL"} code=${result.code} host=${result.host} node=${result.nodeName} message=${result.message}`)
  for (const step of result.steps) {
    const status = step.status ? ` status=${step.status}` : ""
    const endpoint = step.endpoint ? ` endpoint=${step.endpoint}` : ""
    const address = step.address ? ` address=${step.address}` : ""
    const addresses = step.addresses?.length ? ` addresses=${step.addresses.join(",")}` : ""
    console.log(`${step.ok ? "PASS" : "FAIL"} ${step.name} code=${step.code}${status}${endpoint} ms=${step.durationMs}${address}${addresses} message=${step.message}`)
  }

  if (!result.ok) process.exitCode = 1
}

main().catch((error: any) => {
  console.log(`Diagnostic FAIL code=${error?.code || "UNKNOWN_ERROR"} message=${error?.message || "Diagnostic failed"}`)
  process.exitCode = 1
})
