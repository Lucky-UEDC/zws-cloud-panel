import type { NextRequest } from "next/server"
import type { AdminProfile, Customer } from "@prisma/client"
import { issueClientSession as createClientSession, issueStaffSession as createStaffSession } from "@/lib/auth-flows"
import type { DeviceContext, RiskAssessment } from "@/lib/auth/mfa/types"

type StaffUser = Pick<AdminProfile, "id" | "email" | "displayName" | "role">
type ClientUser = Pick<Customer, "id" | "email" | "name" | "status">
type PasswordSessionTracking = {
  device?: DeviceContext
  fingerprint?: string
  risk?: RiskAssessment
  mfaVerifiedAt?: Date | string | null
}

export async function completePasswordLoginSession(input: {
  user: StaffUser | ClientUser
  role: "admin" | "client"
  sessionTimeoutMinutes: number
  request: NextRequest
  tracking?: PasswordSessionTracking
}) {
  if (input.role === "admin") {
    return createStaffSession(input.user as StaffUser, input.sessionTimeoutMinutes, input.request, input.tracking)
  }
  return createClientSession(input.user as ClientUser, input.sessionTimeoutMinutes, input.request, input.tracking)
}
