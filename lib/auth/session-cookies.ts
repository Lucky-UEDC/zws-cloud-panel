export const SESSION_COOKIE_NAMES = {
  admin: "__Host-admin_token",
  client: "__Host-client_token",
} as const

export const LEGACY_SESSION_COOKIE_NAMES = {
  admin: "admin_token",
  client: "client_token",
} as const

export const ALL_AUTH_COOKIE_NAMES = [
  SESSION_COOKIE_NAMES.admin,
  SESSION_COOKIE_NAMES.client,
  LEGACY_SESSION_COOKIE_NAMES.admin,
  LEGACY_SESSION_COOKIE_NAMES.client,
] as const

export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
  path: "/",
}
