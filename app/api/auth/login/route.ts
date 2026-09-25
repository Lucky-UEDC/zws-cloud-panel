import { NextRequest } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/db'
import { checkLoginRateLimit, markLoginResult } from '@/lib/auth-rate-limit'
import { getSetting, type SecuritySettings } from '@/lib/settings'
import { createAuthChallenge, pruneExpiredChallenges } from '@/lib/auth-flows'
import { apiError, apiSuccess } from '@/lib/api-response'
import { createPanelLog } from '@/lib/panel-log'
import { sendCustomerPhoneOtp } from '@/lib/whatsapp/otp'
import { maskWhatsAppPhone } from '@/lib/whatsapp/format'
import { beginMfaOrBypass, buildMfaContext } from '@/lib/auth/mfa/orchestrator'
import type { MfaSubject } from '@/lib/auth/mfa/types'
import { normalizeStaffRole } from '@/lib/roles'
import { ensureMfaSettings, getMfaMethodAvailability, isEmailMfaDeliveryReady } from '@/lib/auth/mfa/settings'
import { getRuntimeSecurityPolicy } from '@/lib/security-policy'
import { completePasswordLoginSession } from '@/lib/auth/password-session'
import { extractClientIp } from '@/lib/request-context'
import { otpErrorResponse } from '@/lib/whatsapp/otp-errors'
import { rejectIfPayload } from '@/lib/security/forms'
import { getSecurityContext, logSecurityEvent, securityJson } from '@/lib/security/abuse'
import { verifyTurnstileTokenWithOptions } from '@/lib/security/turnstile'
import { isCloudflareWhitelisted } from '@/lib/security/security-settings'
import {
  getActiveLoginSecurityBlocks,
  isTrustedEmergencyIp,
  loginSecurityDebug,
  unblockRecoverableLoginBlocks,
} from '@/lib/security/login-security'

function authStageLog(stage: string, detail: Record<string, unknown>) {
  console.info('[AUTH] login_stage', { stage, ...detail })
}

function metadataRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>
  return {}
}

function shouldRequireMfa(policy: Awaited<ReturnType<typeof getRuntimeSecurityPolicy>>, usable: boolean, riskForceMfa: boolean) {
  if (!usable || policy.mfaMode === "disabled") return false
  if (policy.mfaMode === "enforce") return true
  return riskForceMfa
}

async function getPasswordLoginMfaDecision(
  subject: MfaSubject,
  settings: Awaited<ReturnType<typeof ensureMfaSettings>>,
  policy: Awaited<ReturnType<typeof getRuntimeSecurityPolicy>>,
  riskForceMfa: boolean,
) {
  const available = getMfaMethodAvailability(subject, settings)
  const emailDeliveryReady = available.email ? await isEmailMfaDeliveryReady() : false
  const deliverable = {
    ...available,
    email: available.email && emailDeliveryReady,
  }
  const hasDeliverableMethod = Boolean(deliverable.totp || deliverable.whatsapp || deliverable.recovery || deliverable.email)
  const hasOnlyUndeliverableEmail = Boolean(available.email && !emailDeliveryReady && !available.totp && !available.whatsapp && !available.recovery)

  return {
    requireMfa: shouldRequireMfa(policy, hasDeliverableMethod, riskForceMfa),
    hasOnlyUndeliverableEmail,
    available,
  }
}

export async function POST(request: NextRequest) {
  const ipAddress = extractClientIp(request)
  const ctx = await getSecurityContext(request)

  try {
    await pruneExpiredChallenges().catch(() => {})

    const body = (await request.json()) as { email?: string; password?: string; turnstileToken?: string; "cf-turnstile-response"?: string }
    const email = String(body.email || '').trim().toLowerCase()
    const password = String(body.password || '')
    const turnstileToken = body.turnstileToken || body["cf-turnstile-response"]

    const captcha = await verifyTurnstileTokenWithOptions(ctx, turnstileToken, "login", {
      blockOnFailure: false,
      expectedAction: "login",
    })
    const captchaProviderUnavailable = !captcha.ok && captcha.code === "captcha_provider_error"
    loginSecurityDebug("login_captcha_result", {
      email,
      ok: captcha.ok,
      code: captcha.ok ? "ok" : captcha.code,
      tokenPresent: Boolean(String(turnstileToken || "").trim()),
    })
    if (!captcha.ok && !captchaProviderUnavailable) return captcha.response

    const emailPayload = await rejectIfPayload(ctx, email, "email")
    if (!emailPayload.ok) return emailPayload.response

    if (!email || !password) {
      return apiError('invalid_credentials', 'Email and password are required', 400)
    }

    authStageLog('input_validated', { email })

    let security: SecuritySettings
    try {
      security = await getSetting<SecuritySettings>('security_settings')
      authStageLog('settings_loaded', { email })
    } catch (error) {
      console.error('[AUTH] settings_load_failed', { email, error })
      return apiError('server_error', 'Unable to process login right now. Please try again shortly.', 500)
    }

    let adminUser: Awaited<ReturnType<typeof prisma.adminProfile.findUnique>>
    let customer: Awaited<ReturnType<typeof prisma.customer.findUnique>>

    try {
      ;[adminUser, customer] = await Promise.all([
        prisma.adminProfile.findUnique({ where: { email } }),
        prisma.customer.findUnique({ where: { email } }),
      ])
      authStageLog('db_lookup_completed', {
        email,
        adminFound: Boolean(adminUser),
        customerFound: Boolean(customer),
      })
    } catch (error) {
      console.error('[AUTH] db_lookup_failed', { email, error })
      return apiError('server_error', 'Unable to process login right now. Please try again shortly.', 500)
    }

    if (!adminUser && !customer) {
      await markLoginResult('client', email, ipAddress, false, security, { reason: "user_not_found", userAgent: ctx.userAgent })
      await createPanelLog({ category: "Auth", level: "warn", message: "Login failed", actorEmail: email, metadata: { reason: "user_not_found", ipAddress } })
      return apiError('user_not_found', 'No account found for this email address.', 404)
    }

    if (adminUser) {
      if (!adminUser.isActive) {
        await markLoginResult('admin', email, ipAddress, false, security, { reason: "inactive_admin", userAgent: ctx.userAgent })
        return apiError('invalid_credentials', 'Invalid email or password', 401)
      }

      let isValid = false
      try {
        isValid = await bcrypt.compare(password, adminUser.hashedPassword)
        authStageLog('password_checked_admin', { email, valid: isValid })
      } catch (error) {
        console.error('[AUTH] admin_password_compare_failed', { email, error })
        return apiError('server_error', 'Unable to process login right now. Please try again shortly.', 500)
      }

      if (!isValid) {
        const limit = await checkLoginRateLimit('admin', email, ipAddress, security)
        if (!limit.allowed) {
          return apiError('rate_limited', `Too many login attempts. Try again in ${limit.retryAfterSeconds} seconds.`, 429)
        }
        await markLoginResult('admin', email, ipAddress, false, security, { reason: "invalid_password", userAgent: ctx.userAgent })
        await createPanelLog({ category: "Auth", level: "warn", message: "Admin login failed", actorType: "admin", actorId: adminUser.id, actorEmail: email, metadata: { reason: "invalid_password", ipAddress } })
        return apiError('invalid_credentials', 'Invalid email or password', 401)
      }

      const normalizedAdminRole = normalizeStaffRole(adminUser.role)
      if (!normalizedAdminRole || !security.allowedAdminRoles.includes(normalizedAdminRole as any)) {
        await markLoginResult('admin', email, ipAddress, false, security, { reason: "role_not_allowed", userAgent: ctx.userAgent })
        return apiError('invalid_credentials', 'Invalid email or password', 401)
      }

      const blocks = await getActiveLoginSecurityBlocks(ctx)
      loginSecurityDebug("login_block_state", {
        email,
        ipBlockId: blocks.ipBlock?.id || null,
        ipBlockReason: blocks.ipBlock?.reason || null,
        deviceBlockId: blocks.deviceBlock?.id || null,
        deviceBlockReason: blocks.deviceBlock?.reason || null,
        hardIpBlock: Boolean(blocks.hardIpBlock),
      })
      if (blocks.hardIpBlock) {
        await logSecurityEvent(ctx, "login_hard_ip_block_denied", "warn", "denied", {
          actorEmail: email,
          ipBlockId: blocks.hardIpBlock.id || null,
          reason: blocks.hardIpBlock.reason || null,
          attackType: blocks.hardIpBlock.attackType || null,
        })
        return securityJson("ip_permanently_banned", "IP permanently banned.", 403, {
          reason: blocks.hardIpBlock.reason || "ip_permanently_banned",
          ip: ctx.ip,
          page: ctx.route,
          ruleTriggered: blocks.hardIpBlock.attackType || "permanent_ip_ban",
        })
      }

      const emergencyAllowed = captchaProviderUnavailable && Boolean((adminUser as any).trustedAdmin) && isTrustedEmergencyIp(ctx.ip)
      if (captchaProviderUnavailable && !emergencyAllowed) {
        await logSecurityEvent(ctx, "admin_emergency_login_denied", "warn", "denied", {
          actorEmail: email,
          trustedAdmin: Boolean((adminUser as any).trustedAdmin),
          trustedIp: isTrustedEmergencyIp(ctx.ip),
        })
        return captcha.response
      }
      if (emergencyAllowed) {
        await logSecurityEvent(ctx, "admin_emergency_login_turnstile_provider_bypass", "warn", "allowed", {
          actorEmail: email,
          ip: ctx.ip,
        })
      } else if (await isCloudflareWhitelisted(ctx, { email })) {
        await logSecurityEvent(ctx, "cloudflare_whitelist_bypass", "info", "allowed", { actorEmail: email, surface: "adminLogin" })
      } else {
        await unblockRecoverableLoginBlocks(ctx, blocks, email)
      }
      await markLoginResult('admin', email, ipAddress, true, security)

      try {
        const subject: MfaSubject = {
          userType: 'admin',
          userId: adminUser.id,
          role: normalizedAdminRole,
          email: adminUser.email,
          name: adminUser.displayName,
          phone: (adminUser as any).whatsappMfaEnabled && (adminUser as any).phoneVerified ? (adminUser as any).phone : null,
          phoneVerified: (adminUser as any).phoneVerified,
          hashedPassword: adminUser.hashedPassword,
          legacyTotpEnabled: adminUser.twoFactorEnabled,
          legacyTotpSecret: adminUser.twoFactorSecret,
          legacyBackupCodes: adminUser.twoFactorBackupCodes,
        }
        const [mfaSettings, policy, context] = await Promise.all([ensureMfaSettings(subject), getRuntimeSecurityPolicy(), buildMfaContext(request, subject)])
        const mfaDecision = await getPasswordLoginMfaDecision(subject, mfaSettings, policy, context.risk.forceMfa)
        if (policy.mfaMode === "enforce" && mfaDecision.hasOnlyUndeliverableEmail) {
          return apiError('mfa_delivery_unavailable', 'Email MFA is enabled but SMTP is not configured. Configure email delivery or another MFA method.', 503)
        }
        if (!mfaDecision.requireMfa) {
          const session = await completePasswordLoginSession({
            user: adminUser,
            role: "admin",
            sessionTimeoutMinutes: security.sessionTimeoutMinutes,
            request,
            tracking: { device: context.device, fingerprint: context.fingerprint, risk: context.risk, mfaVerifiedAt: null },
          })
          return apiSuccess({ authenticated: true, redirectTo: session.redirectTo, role: session.role, email: adminUser.email })
        }
        const mfa = await beginMfaOrBypass({ request, subject, context })
        return apiSuccess({
          code: 'mfa_required',
          method: mfa.method,
          challengeToken: mfa.challengeToken,
          redirectTo: '/login/2fa',
          role: adminUser.role,
          email: adminUser.email,
          maskedTarget: mfa.maskedTarget,
          expiresAt: mfa.expiresAt,
          otpExpiresAt: mfa.otpExpiresAt,
          fallbackMessage: mfa.fallbackMessage,
          riskLevel: mfa.context.risk.level,
          methods: mfa.availableMethods || mfaDecision.available,
        })
      } catch (error) {
        console.error('[AUTH] staff_session_creation_failed', { email, error })
        return apiError('server_error', 'Unable to create session. Please try again.', 500)
      }
    }

    if (!customer?.hashedPassword) {
      await markLoginResult('client', email, ipAddress, false, security, { reason: "missing_password", userAgent: ctx.userAgent })
      return apiError('invalid_credentials', 'Invalid email or password', 401)
    }

    if (!customer.isActive || customer.status === 'SUSPENDED' || customer.status === 'BANNED' || customer.status === 'CLOSED') {
      await markLoginResult('client', email, ipAddress, false, security, { reason: "inactive_suspended_or_banned", userAgent: ctx.userAgent })
      return apiError('invalid_credentials', 'Invalid email or password', 401)
    }

    let isPasswordValid = false
    try {
      isPasswordValid = await bcrypt.compare(password, customer.hashedPassword)
      authStageLog('password_checked_client', { email, valid: isPasswordValid })
    } catch (error) {
      console.error('[AUTH] client_password_compare_failed', { email, error })
      return apiError('server_error', 'Unable to process login right now. Please try again shortly.', 500)
    }

    if (!isPasswordValid) {
      const limit = await checkLoginRateLimit('client', email, ipAddress, security)
      if (!limit.allowed) {
        return apiError('rate_limited', `Too many login attempts. Try again in ${limit.retryAfterSeconds} seconds.`, 429)
      }
      await markLoginResult('client', email, ipAddress, false, security, { reason: "invalid_password", userAgent: ctx.userAgent })
      await createPanelLog({ category: "Auth", level: "warn", message: "Customer login failed", actorType: "customer", actorId: customer.id, actorEmail: email, customerId: customer.id, metadata: { reason: "invalid_password", ipAddress } })
      return apiError('invalid_credentials', 'Invalid email or password', 401)
    }

    const blocks = await getActiveLoginSecurityBlocks(ctx)
    loginSecurityDebug("login_block_state", {
      email,
      ipBlockId: blocks.ipBlock?.id || null,
      ipBlockReason: blocks.ipBlock?.reason || null,
      deviceBlockId: blocks.deviceBlock?.id || null,
      deviceBlockReason: blocks.deviceBlock?.reason || null,
      hardIpBlock: Boolean(blocks.hardIpBlock),
    })
    if (blocks.hardIpBlock) {
      await logSecurityEvent(ctx, "login_hard_ip_block_denied", "warn", "denied", {
        actorEmail: email,
        ipBlockId: blocks.hardIpBlock.id || null,
        reason: blocks.hardIpBlock.reason || null,
        attackType: blocks.hardIpBlock.attackType || null,
      })
      return securityJson("ip_permanently_banned", "IP permanently banned.", 403, {
        reason: blocks.hardIpBlock.reason || "ip_permanently_banned",
        ip: ctx.ip,
        page: ctx.route,
        ruleTriggered: blocks.hardIpBlock.attackType || "permanent_ip_ban",
      })
    }
    if (captchaProviderUnavailable) return captcha.response
    if (await isCloudflareWhitelisted(ctx, { email, customerId: customer.id })) {
      await logSecurityEvent(ctx, "cloudflare_whitelist_bypass", "info", "allowed", { actorEmail: email, customerId: customer.id, surface: "login" })
    } else {
      await unblockRecoverableLoginBlocks(ctx, blocks, email)
    }
    await markLoginResult('client', email, ipAddress, true, security)

    const customerMetadata = metadataRecord(customer.metadata)

    if (customerMetadata.requiresEmailVerification && !customer.emailVerifiedAt) {
      await createPanelLog({
        category: "Auth",
        level: "info",
        message: "Customer login continuing with secondary email verification pending",
        actorType: "customer",
        actorId: customer.id,
        actorEmail: email,
        customerId: customer.id,
        metadata: { reason: "email_unverified_secondary", ipAddress },
      }).catch(() => null)
    }

    if (!customer.phoneVerified && (customer.phone || security.requirePhoneVerificationOnLogin)) {
      const challenge = await createAuthChallenge({
        userType: 'customer',
        userId: customer.id,
        role: 'phone_verification',
        email: customer.email,
      })
      if (customer.phone) {
        const otpResult = await sendCustomerPhoneOtp({ customerId: customer.id }).catch((error) => {
          console.error('[AUTH] phone_verification_otp_send_failed', { email, error })
          return { error }
        })
        if ("error" in otpResult) {
          const normalized = otpErrorResponse(otpResult.error, "worker_dispatch")
          return apiError(normalized.body.code, normalized.body.message, normalized.status)
        }
        await createPanelLog({
          category: "Auth",
          level: "warn",
          message: "Customer login blocked: phone verification required",
          actorType: "customer",
          actorId: customer.id,
          actorEmail: email,
          customerId: customer.id,
          metadata: { reason: "phone_unverified", ipAddress },
        })
        return apiSuccess({
          code: 'phone_verification_required',
          challengeToken: challenge.challengeToken,
          maskedPhone: otpResult.toMasked || maskWhatsAppPhone(customer.phone),
          cooldownUntil: otpResult.cooldownUntil,
          expiresAt: otpResult.expiresAt,
          redirectTo: '/verify-phone',
          role: 'client',
          email: customer.email,
        })
      }
      // Customer has no phone — redirect to setup page to add phone first
      await createPanelLog({
        category: "Auth",
        level: "warn",
        message: "Customer login blocked: phone setup required",
        actorType: "customer",
        actorId: customer.id,
        actorEmail: email,
        customerId: customer.id,
        metadata: { reason: "phone_missing", ipAddress },
      })
      return apiSuccess({
        code: 'phone_setup_required',
        challengeToken: challenge.challengeToken,
        redirectTo: '/verify-phone?setup=1',
        role: 'client',
        email: customer.email,
      })
    }

    try {
      const subject: MfaSubject = {
        userType: 'customer',
        userId: customer.id,
        role: 'client',
        email: customer.email,
        name: customer.name,
        phone: customer.phone,
        phoneVerified: customer.phoneVerified,
        hashedPassword: customer.hashedPassword,
        legacyTotpEnabled: customer.twoFactorEnabled,
        legacyTotpSecret: customer.twoFactorSecret,
        legacyBackupCodes: customer.twoFactorBackupCodes,
      }
      const [mfaSettings, policy, context] = await Promise.all([ensureMfaSettings(subject), getRuntimeSecurityPolicy(), buildMfaContext(request, subject)])
      const mfaDecision = await getPasswordLoginMfaDecision(subject, mfaSettings, policy, context.risk.forceMfa)
      if (policy.mfaMode === "enforce" && mfaDecision.hasOnlyUndeliverableEmail) {
        return apiError('mfa_delivery_unavailable', 'Email MFA is enabled but SMTP is not configured. Configure email delivery or another MFA method.', 503)
      }
      if (!mfaDecision.requireMfa) {
        const session = await completePasswordLoginSession({
          user: customer,
          role: "client",
          sessionTimeoutMinutes: security.sessionTimeoutMinutes,
          request,
          tracking: { device: context.device, fingerprint: context.fingerprint, risk: context.risk, mfaVerifiedAt: null },
        })
        return apiSuccess({ authenticated: true, redirectTo: session.redirectTo, role: session.role, email: customer.email })
      }
      const mfa = await beginMfaOrBypass({ request, subject, context })
      return apiSuccess({
        code: 'mfa_required',
        method: mfa.method,
        challengeToken: mfa.challengeToken,
        redirectTo: '/login/2fa',
        role: 'client',
        email: customer.email,
        maskedTarget: mfa.maskedTarget,
        expiresAt: mfa.expiresAt,
        otpExpiresAt: mfa.otpExpiresAt,
        fallbackMessage: mfa.fallbackMessage,
        riskLevel: mfa.context.risk.level,
        methods: mfa.availableMethods || mfaDecision.available,
      })
    } catch (error) {
      console.error('[AUTH] client_session_creation_failed', { email, error })
      return apiError('server_error', 'Unable to create session. Please try again.', 500)
    }
  } catch (error) {
    console.error('[AUTH] login_error', error)
    return apiError('server_error', 'Unable to process login right now. Please try again shortly.', 500)
  }
}
