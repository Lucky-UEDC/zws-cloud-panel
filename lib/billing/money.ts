import { Prisma } from "@prisma/client"

export type MoneyValue = number | string | Prisma.Decimal

const SCALE = 100

export function toPaise(value: MoneyValue): number {
  if (value instanceof Prisma.Decimal) value = value.toNumber()
  const n = typeof value === "string" ? Number(value) : value
  if (!Number.isFinite(n)) return 0
  return Math.round((n + Number.EPSILON) * SCALE)
}

export function fromPaise(paise: number): number {
  return Math.round(paise) / SCALE
}

export function money(value: MoneyValue): number {
  return fromPaise(toPaise(value))
}

export function round2(value: MoneyValue): number {
  return money(value)
}

export function centsEqual(left: MoneyValue, right: MoneyValue): boolean {
  return toPaise(left) === toPaise(right)
}

export function centsLess(left: MoneyValue, right: MoneyValue): boolean {
  return toPaise(left) < toPaise(right)
}

export function centsAtMost(left: MoneyValue, right: MoneyValue): boolean {
  return toPaise(left) <= toPaise(right)
}

export function centsGreater(left: MoneyValue, right: MoneyValue): boolean {
  return toPaise(left) > toPaise(right)
}

export function add(...values: MoneyValue[]): number {
  return fromPaise(values.reduce<number>((sum, value) => sum + toPaise(value), 0))
}

export function sub(left: MoneyValue, ...rest: MoneyValue[]): number {
  return fromPaise(rest.reduce<number>((acc, value) => acc - toPaise(value), toPaise(left)))
}

export function max(...values: MoneyValue[]): number {
  return fromPaise(values.reduce<number>((best, value) => Math.max(best, toPaise(value)), Number.NEGATIVE_INFINITY))
}

export function min(...values: MoneyValue[]): number {
  return fromPaise(values.reduce<number>((best, value) => Math.min(best, toPaise(value)), Number.POSITIVE_INFINITY))
}

export function percentOf(amount: MoneyValue, percent: MoneyValue): number {
  const amt = toPaise(amount)
  const pct = toPaise(percent) / (100 * SCALE)
  return fromPaise(Math.round(amt * pct))
}

export function mulAmount(amount: MoneyValue, factor: number): number {
  const amt = toPaise(amount)
  return fromPaise(Math.round(amt * factor))
}

export function divAmount(amount: MoneyValue, divisor: number): number {
  if (!Number.isFinite(divisor) || divisor === 0) return 0
  return fromPaise(Math.round(toPaise(amount) / divisor))
}

export function prorate(amount: MoneyValue, remainingDays: number, totalDays: number, floorAt = 0): number {
  if (!Number.isFinite(remainingDays) || !Number.isFinite(totalDays) || totalDays <= 0) return money(amount)
  const ratio = Math.max(0, remainingDays) / totalDays
  return max(money(amount) > 0 ? floorAt : 0, fromPaise(Math.round(toPaise(amount) * ratio)))
}

export function gbFromBytes(bytes: number | bigint | string | null | undefined): number {
  if (bytes === null || bytes === undefined) return 0
  const value = typeof bytes === "bigint" ? Number(bytes) : Number(bytes)
  if (!Number.isFinite(value) || value <= 0) return 0
  return Math.round((value / (1024 ** 3)) * 100) / 100
}

export function bytesFromGb(gb: number): number {
  const safe = Number.isFinite(gb) ? gb : 0
  return Math.round(safe * 1024 ** 3)
}