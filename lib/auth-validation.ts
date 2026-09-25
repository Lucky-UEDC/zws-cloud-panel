import { isStrictPhoneNumber } from "@/lib/phone-number"

/**
 * Frontend-only validation helpers for auth forms.
 *
 * These are UI-layer checks — the real backend (Codex) MUST revalidate
 * every field server-side. Shared strings are exported so the same copy
 * is used across login / signup / reset-password screens.
 */

export const EMAIL_REGEX =
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Accepts only E.164-compatible phone input with harmless formatting.
export const PHONE_REGEX = /^[+\d\s()-]{8,24}$/

export function isValidEmail(value: string) {
  return EMAIL_REGEX.test(value.trim())
}

export function isValidPhone(value: string) {
  return isStrictPhoneNumber(value)
}

export type PasswordStrength = {
  score: 0 | 1 | 2 | 3 | 4
  label: "Too short" | "Weak" | "Fair" | "Good" | "Strong"
  hints: string[]
}

/**
 * Scores a password on a 0–4 scale. Mirrors common UX guidance:
 * length is the single biggest lever, then character-class variety.
 */
export function scorePassword(pw: string): PasswordStrength {
  const hints: string[] = []
  if (pw.length < 8) hints.push("At least 8 characters")
  if (!/[A-Z]/.test(pw)) hints.push("An uppercase letter")
  if (!/[a-z]/.test(pw)) hints.push("A lowercase letter")
  if (!/[0-9]/.test(pw)) hints.push("A number")
  if (!/[^A-Za-z0-9]/.test(pw)) hints.push("A symbol (e.g. !@#)")

  if (pw.length < 8) return { score: 0, label: "Too short", hints }

  let classes = 0
  if (/[A-Z]/.test(pw)) classes++
  if (/[a-z]/.test(pw)) classes++
  if (/[0-9]/.test(pw)) classes++
  if (/[^A-Za-z0-9]/.test(pw)) classes++

  // Base on classes, bump with length.
  let score: 0 | 1 | 2 | 3 | 4 = 1
  if (classes >= 2) score = 2
  if (classes >= 3 && pw.length >= 10) score = 3
  if (classes === 4 && pw.length >= 12) score = 4

  const label: PasswordStrength["label"] =
    score === 1 ? "Weak" : score === 2 ? "Fair" : score === 3 ? "Good" : "Strong"

  return { score, label, hints }
}

/** A list of demo emails that simulate "already registered" errors. */
export const TAKEN_EMAILS = new Set([
  "taken@zws.cloud",
  "used@zws.cloud",
  "admin@zws.cloud",
])

/**
 * Validates an email and returns an error message if invalid, or empty string if valid.
 */
export function validateEmail(email: string): string {
  if (!email.trim()) return "Email is required"
  if (!isValidEmail(email)) return "Please enter a valid email address"
  return ""
}

/**
 * Validates a password and returns an error message if invalid, or empty string if valid.
 */
export function validatePassword(password: string): string {
  if (!password) return "Password is required"
  if (password.length < 8) return "Password must be at least 8 characters"
  return ""
}

/**
 * Alias for scorePassword to match component imports.
 */
export function getPasswordStrength(password: string): PasswordStrength {
  return scorePassword(password)
}
