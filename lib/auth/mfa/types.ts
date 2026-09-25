import type { NextRequest } from "next/server"
import type { StaffRole } from "@/lib/roles"

export type MfaUserType = "customer" | "admin"
export type MfaMethod = "totp" | "whatsapp" | "email" | "recovery" | "trusted_device"
export type MfaRiskLevel = "low" | "medium" | "high" | "critical"

export type MfaSubject = {
  userType: MfaUserType
  userId: string
  role: "client" | StaffRole
  email: string
  name?: string | null
  phone?: string | null
  phoneVerified?: boolean | null
  hashedPassword?: string | null
  legacyTotpEnabled?: boolean | null
  legacyTotpSecret?: string | null
  legacyBackupCodes?: unknown
}

export type DeviceContext = {
  ip: string
  city: string | null
  region: string | null
  country: string | null
  timezone: string | null
  asn: string | null
  provider: string | null
  proxy: boolean
  vpn?: boolean
  tor?: boolean
  relay?: boolean
  browser: string
  browserVersion: string | null
  os: string
  osVersion: string | null
  deviceType: string
  platform: string
  cpuArchitecture: string | null
  userAgent: string
}

export type RiskAssessment = {
  level: MfaRiskLevel
  score: number
  reasons: string[]
  forceMfa: boolean
}

export type MfaRequestContext = {
  request: NextRequest
  device: DeviceContext
  fingerprint: string
  risk: RiskAssessment
}
