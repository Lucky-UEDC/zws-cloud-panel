import { getServiceIntegrationConfig } from "@/lib/integration-config"

function truthy(value: unknown) {
  return ["1", "true", "yes", "on", "enabled"].includes(String(value || "").trim().toLowerCase())
}

export async function isGoogleOAuthLoginEnabled() {
  if (truthy(process.env.GOOGLE_OAUTH_LOGIN_ENABLED) || truthy(process.env.NEXT_PUBLIC_GOOGLE_OAUTH_LOGIN_ENABLED)) return true
  const runtime = await getServiceIntegrationConfig("googleOAuth").catch(() => ({} as Record<string, unknown>))
  return truthy(runtime.enabled)
}

export function isGoogleOAuthLoginEnabledClient() {
  return truthy(process.env.NEXT_PUBLIC_GOOGLE_OAUTH_LOGIN_ENABLED)
}
