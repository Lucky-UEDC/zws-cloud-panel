import { prisma } from "@/lib/db"

export const NOTIFICATION_CATEGORIES = ["auth", "order", "invoice", "server", "support", "marketing"] as const
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number]

export function normalizeNotificationCategory(input: unknown): NotificationCategory {
  const value = String(input || "").toLowerCase()
  return (NOTIFICATION_CATEGORIES as readonly string[]).includes(value) ? value as NotificationCategory : "order"
}

export function isMarketingCategory(category: unknown) {
  return normalizeNotificationCategory(category) === "marketing"
}

export async function getCustomerNotificationPreferences(customerId: string) {
  const rows = await prisma.customerNotificationPreference.findMany({ where: { customerId } })
  const byCategory = new Map(rows.map((row) => [row.category, row]))
  return NOTIFICATION_CATEGORIES.map((category) => byCategory.get(category) || {
    id: "",
    customerId,
    category,
    emailEnabled: true,
    whatsappEnabled: true,
    marketingEnabled: true,
    transactionalEnabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
}

export async function canSendWhatsAppToCustomer(input: {
  customerId?: string | null
  category?: string | null
  marketing?: boolean
}) {
  if (!input.customerId) return true
  const customer = await prisma.customer.findUnique({
    where: { id: input.customerId },
    select: { whatsappOptIn: true, phoneVerified: true },
  }).catch(() => null)
  if (!customer?.whatsappOptIn || !customer.phoneVerified) return false

  const category = normalizeNotificationCategory(input.category)
  const preference = await prisma.customerNotificationPreference.findUnique({
    where: { customerId_category: { customerId: input.customerId, category } },
  }).catch(() => null)
  if (!preference) return true
  if (!preference.whatsappEnabled) return false
  if (input.marketing && !preference.marketingEnabled) return false
  if (!input.marketing && !preference.transactionalEnabled) return false
  return true
}

export async function upsertCustomerNotificationPreferences(customerId: string, preferences: Array<{
  category: string
  emailEnabled?: boolean
  whatsappEnabled?: boolean
  marketingEnabled?: boolean
  transactionalEnabled?: boolean
}>) {
  await Promise.all(preferences.map((preference) => {
    const category = normalizeNotificationCategory(preference.category)
    return prisma.customerNotificationPreference.upsert({
      where: { customerId_category: { customerId, category } },
      update: {
        emailEnabled: preference.emailEnabled,
        whatsappEnabled: preference.whatsappEnabled,
        marketingEnabled: preference.marketingEnabled,
        transactionalEnabled: preference.transactionalEnabled,
      },
      create: {
        customerId,
        category,
        emailEnabled: preference.emailEnabled ?? true,
        whatsappEnabled: preference.whatsappEnabled ?? true,
        marketingEnabled: preference.marketingEnabled ?? true,
        transactionalEnabled: preference.transactionalEnabled ?? true,
      },
    })
  }))
}
