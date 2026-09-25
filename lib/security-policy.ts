import { prisma } from "@/lib/db"

const SECURITY_POLICY_KEY = "runtime_security_policy"

export type MfaPolicyMode = "disabled" | "recommend" | "enforce"

export type RuntimeSecurityPolicy = {
  mfaMode: MfaPolicyMode
  mfaEnforcementEnabled: boolean
}

const DEFAULT_POLICY: RuntimeSecurityPolicy = {
  mfaMode: "recommend",
  mfaEnforcementEnabled: false,
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function normalizeMfaMode(value: unknown, legacyEnforced: unknown): MfaPolicyMode {
  if (value === "disabled" || value === "recommend" || value === "enforce") return value
  if (legacyEnforced === true) return "enforce"
  return DEFAULT_POLICY.mfaMode
}

export async function getRuntimeSecurityPolicy(): Promise<RuntimeSecurityPolicy> {
  const row = await (prisma as any).appSetting.findUnique({ where: { key: SECURITY_POLICY_KEY } }).catch(() => null)
  const value = object(row?.value)
  const mfaMode = normalizeMfaMode(value.mfaMode, value.mfaEnforcementEnabled)
  return {
    ...DEFAULT_POLICY,
    mfaMode,
    mfaEnforcementEnabled: mfaMode === "enforce",
  }
}

export async function updateRuntimeSecurityPolicy(input: Partial<RuntimeSecurityPolicy>, updatedBy?: string | null) {
  const mfaMode = normalizeMfaMode(input.mfaMode, input.mfaEnforcementEnabled)
  const policy: RuntimeSecurityPolicy = {
    ...DEFAULT_POLICY,
    mfaMode,
    mfaEnforcementEnabled: mfaMode === "enforce",
  }
  await (prisma as any).appSetting.upsert({
    where: { key: SECURITY_POLICY_KEY },
    update: { value: policy as any, group: "security", isSecret: false, updatedBy: updatedBy || null },
    create: { key: SECURITY_POLICY_KEY, value: policy as any, group: "security", isSecret: false, updatedBy: updatedBy || null },
  })
  return policy
}
