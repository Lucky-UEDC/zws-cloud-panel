#!/usr/bin/env node

import "dotenv/config"
import { prisma } from "@/lib/db"
import { assertDatabaseUrl } from "@/lib/db-url"
import { updateSystemSecuritySettings, validateTurnstileMode, type TurnstileMode } from "@/lib/security/security-settings"

function argValue(name: string) {
  const prefix = `--${name}=`
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length)
}

async function main() {
  assertDatabaseUrl()

  const siteKey = argValue("site-key") || process.env.TURNSTILE_SEED_SITE_KEY || ""
  const secretKey = argValue("secret-key") || process.env.TURNSTILE_SEED_SECRET_KEY || ""
  const mode = validateTurnstileMode(argValue("mode") || process.env.TURNSTILE_SEED_MODE || "managed")
  const enabled = (argValue("enabled") || process.env.TURNSTILE_SEED_ENABLED || "true") !== "false"

  if (!siteKey || !secretKey) {
    throw new Error("Provide --site-key/--secret-key or TURNSTILE_SEED_SITE_KEY/TURNSTILE_SEED_SECRET_KEY.")
  }

  const settings = await updateSystemSecuritySettings({
    enabled,
    mode: enabled ? "LOW" : "OFF",
    turnstileEnabled: enabled,
    turnstileSiteKey: siteKey,
    turnstileSecretKey: secretKey,
    turnstileMode: mode as TurnstileMode,
    protectLogin: true,
    protectSignup: true,
    protectContact: true,
    protectCheckout: true,
    protectTickets: true,
  })

  console.log(JSON.stringify({
    success: true,
    turnstileEnabled: settings.turnstileEnabled,
    enabled: settings.enabled,
    mode: settings.mode,
    turnstileConfigured: settings.turnstileConfigured,
    turnstileMode: settings.turnstileMode,
    protectLogin: settings.protectLogin,
    protectSignup: settings.protectSignup,
    protectContact: settings.protectContact,
    protectCheckout: settings.protectCheckout,
    protectTickets: settings.protectTickets,
  }, null, 2))
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined)
  })
