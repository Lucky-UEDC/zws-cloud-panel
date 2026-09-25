import { z } from "zod"

export const BACKUP_SCHEDULE_OPTIONS = [30, 60, 180, 360, 720, 1440] as const

export const backupServiceSettingsSchema = z.object({
  version: z.number().default(1),
  enabled: z.boolean().default(true),
  enforcePlanPurchase: z.boolean().default(true),
  defaultStorageGb: z.coerce.number().int().min(0).default(100),
  defaultRetention: z.coerce.number().int().min(0).default(10),
  defaultOverageRatePerGb: z.coerce.number().min(0).default(1),
  defaultScheduleMinutes: z.coerce.number().min(30).default(180),
  defaultScheduleOptions: z.array(z.coerce.number().int().min(30)).default([...BACKUP_SCHEDULE_OPTIONS]),
  gracePeriodDays: z.coerce.number().int().min(0).default(3),
  notifyOnBackup: z.boolean().default(true),
  notifyOnOverage: z.boolean().default(true),
  allowBackupDownload: z.boolean().default(false),
  restoreRequiresActivePlan: z.boolean().default(false),
  updatedAt: z.string().optional(),
  updatedBy: z.string().optional(),
})

export const snapshotServiceSettingsSchema = z.object({
  version: z.number().default(1),
  enabled: z.boolean().default(true),
  model: z.enum(["per_snapshot", "plan"]).default("per_snapshot"),
  perSnapshotPrice: z.coerce.number().min(0).default(20),
  enabledSnapshots: z.boolean().default(true),
  includedSnapshots: z.coerce.number().int().min(0).default(0),
  overageSnapshotPrice: z.coerce.number().min(0).default(20),
  maxSnapshots: z.coerce.number().int().min(0).default(0),
  gracePeriodDays: z.coerce.number().int().min(0).default(0),
  restoreEnabled: z.boolean().default(true),
  updatedAt: z.string().optional(),
  updatedBy: z.string().optional(),
})

export const creditSettingsSchema = z.object({
  version: z.number().default(1),
  enabled: z.boolean().default(true),
  minTopupAmount: z.coerce.number().min(0).default(10),
  maxTopupAmount: z.coerce.number().min(0).default(0),
  razorpayFeePercent: z.coerce.number().min(0).default(3),
  razorpayFixedFee: z.coerce.number().min(0).default(0),
  cashfreeFeePercent: z.coerce.number().min(0).default(3),
  cashfreeFixedFee: z.coerce.number().min(0).default(0),
  phonepeFeePercent: z.coerce.number().min(0).default(0),
  phonepeFixedFee: z.coerce.number().min(0).default(0),
  refundPolicy: z.enum(["full", "per_gateway"]).default("full"),
  updatedAt: z.string().optional(),
  updatedBy: z.string().optional(),
})

export type BackupServiceSettings = z.infer<typeof backupServiceSettingsSchema>
export type SnapshotServiceSettings = z.infer<typeof snapshotServiceSettingsSchema>
export type CreditSettings = z.infer<typeof creditSettingsSchema>

export const DEFAULT_BACKUP_SERVICE_SETTINGS = backupServiceSettingsSchema.parse({})
export const DEFAULT_SNAPSHOT_SERVICE_SETTINGS = snapshotServiceSettingsSchema.parse({})
export const DEFAULT_CREDIT_SETTINGS = creditSettingsSchema.parse({})