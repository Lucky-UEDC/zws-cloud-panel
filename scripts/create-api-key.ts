import "dotenv/config"
import { prisma } from "@/lib/db"
import { generateApiKey } from "@/lib/api/auth"

// Mint an /api/v1 API key. Prints the raw key ONCE (only the hash is stored).
// Usage:
//   pnpm tsx scripts/create-api-key.ts --name "Acme reseller" --type reseller --scopes vm:read,vm:write,vm:reinstall,vm:delete
//   pnpm tsx scripts/create-api-key.ts --name "Client bob" --type client --owner <customerId> --scopes vm:read,vm:write
function arg(flag: string, fallback = "") {
  const i = process.argv.indexOf(flag)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

async function main() {
  const name = arg("--name", "api key")
  const type = arg("--type", "reseller") === "client" ? "client" : "reseller"
  const owner = arg("--owner", "") || null
  const scopes = arg("--scopes", "vm:read").split(",").map((s) => s.trim()).filter(Boolean)
  const rateLimit = Number(arg("--rate", "120")) || 120

  if (type === "client" && !owner) throw new Error("client keys require --owner <customerId>")

  const { raw, prefix, hashedKey } = generateApiKey(type as any)
  const key = await prisma.apiKey.create({
    data: { name, type, ownerCustomerId: owner, scopes, prefix, hashedKey, rateLimitPerMin: rateLimit },
  })

  console.log(JSON.stringify({
    id: key.id,
    type,
    name,
    scopes,
    ownerCustomerId: owner,
    prefix,
    apiKey: raw,
    note: "Store apiKey now — it is not retrievable later.",
  }, null, 2))
}

main()
  .then(async () => { await prisma.$disconnect(); process.exit(0) })
  .catch(async (err) => { console.error("[create-api-key] failed:", err?.message || err); await prisma.$disconnect().catch(() => null); process.exit(1) })
