/**
 * Boot-time environment validation.
 *
 * Calls validateConfig() so missing critical secrets fail fast in production
 * instead of silently degrading to development fallbacks. Exit code 1 on
 * validation failure so docker-entrypoint aborts the container start.
 */
import { validateConfig } from "../lib/config"

async function main() {
  validateConfig()
  console.log("[validate-env] OK - critical configuration present")
  process.exit(0)
}

main().catch((error) => {
  console.error("[validate-env] FAILED:", error instanceof Error ? error.message : error)
  process.exit(1)
})