import { spawn } from "node:child_process"
import { prisma } from "@/lib/db"

export const PAYMENT_VALIDATION_COMMANDS = [
  ["pnpm", ["typecheck"]],
  ["pnpm", ["lint"]],
  ["pnpm", ["build"]],
  ["pnpm", ["exec", "playwright", "test"]],
] as const

export async function queuePaymentValidationRun(input: { gateway?: string | null; trigger?: string | null } = {}) {
  const row = await (prisma as any).paymentValidationRun.create({
    data: {
      status: "queued",
      trigger: input.trigger || "admin_gateway_save",
      gateway: input.gateway || null,
      commands: PAYMENT_VALIDATION_COMMANDS.map(([cmd, args]) => [cmd, ...args]) as any,
      output: {} as any,
    },
  })

  const child = spawn("pnpm", ["exec", "tsx", "scripts/payment-validation-runner.ts", row.id], {
    cwd: process.cwd(),
    detached: true,
    stdio: "ignore",
  })
  child.unref()
  return row
}

export async function latestPaymentValidationRun() {
  return (prisma as any).paymentValidationRun.findFirst({
    orderBy: { createdAt: "desc" },
  }).catch(() => null)
}
