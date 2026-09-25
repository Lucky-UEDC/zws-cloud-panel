import { hostnameFromIp } from "@/lib/vm-hostname"

export const BULK_DISCOUNT_PERCENT = 10
export const BULK_DISCOUNT_MIN_QUANTITY = 10
export const MAX_BULK_QUANTITY = 100

function slugPart(value: unknown, fallback: string) {
  const cleaned = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
  return (cleaned || fallback).slice(0, 24).replace(/-+$/g, "") || fallback
}

export function normalizeOrderQuantity(value: unknown) {
  const parsed = Math.floor(Number(value || 1))
  if (!Number.isFinite(parsed)) return 1
  return Math.max(1, Math.min(MAX_BULK_QUANTITY, parsed))
}

export function planHostnameSlug(value: unknown) {
  return slugPart(value, "plan")
}

export function customerHostnameSlug(value: unknown) {
  const source = String(value || "").split("@")[0]
  return slugPart(source, "user")
}

export function hasBulkDiscount(quantity: unknown) {
  return normalizeOrderQuantity(quantity) >= BULK_DISCOUNT_MIN_QUANTITY
}

export function generateBulkGroupId(prefix = "bulk") {
  const bytes = new Uint8Array(8)
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes)
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256)
    }
  }
  return `${prefix}_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`
}

export function generateVmHostnames(input: {
  planName: unknown
  customerName: unknown
  quantity: unknown
  startAt?: number
  ips?: string[]
}) {
  const quantity = normalizeOrderQuantity(input.quantity)
  if (input.ips?.length) {
    return input.ips.map((ip) => hostnameFromIp(ip) || `ip-pending-${Math.random().toString(16).slice(2, 10)}`)
  }
  const startAt = Math.max(1, Math.floor(Number(input.startAt || 1)))
  const plan = planHostnameSlug(input.planName)
  const customer = customerHostnameSlug(input.customerName)
  return Array.from({ length: quantity }, (_, index) => `zws.${plan}.${customer}-${startAt + index}`)
}

export function calculateBulkPricing(input: {
  unitPrice: unknown
  quantity: unknown
  manualDiscount?: unknown
  taxRate?: unknown
}) {
  const unitPrice = Math.max(0, Number(input.unitPrice || 0))
  const quantity = normalizeOrderQuantity(input.quantity)
  const taxRate = Number.isFinite(Number(input.taxRate)) ? Number(input.taxRate) : 18
  const subtotal = Number((unitPrice * quantity).toFixed(2))
  const automaticBulkDiscount = hasBulkDiscount(quantity) ? Number((subtotal * (BULK_DISCOUNT_PERCENT / 100)).toFixed(2)) : 0
  const manualDiscount = Math.max(0, Number(input.manualDiscount || 0))
  const discountAmount = Math.min(subtotal, Number((automaticBulkDiscount + manualDiscount).toFixed(2)))
  const taxableAmount = Math.max(0, Number((subtotal - discountAmount).toFixed(2)))
  const taxAmount = Number((taxableAmount * (taxRate / 100)).toFixed(2))
  const totalAmount = Number((taxableAmount + taxAmount).toFixed(2))
  return {
    unitPrice,
    quantity,
    subtotal,
    automaticBulkDiscount,
    manualDiscount,
    discountAmount,
    taxableAmount,
    taxAmount,
    totalAmount,
    bulkDiscountPercent: hasBulkDiscount(quantity) ? BULK_DISCOUNT_PERCENT : 0,
  }
}
