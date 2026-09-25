import { prisma } from "@/lib/db"

export async function isCustomerSuspended(customerId: string) {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: {
      id: true,
      status: true,
      suspendUntil: true,
      suspendedReason: true,
      suspendMessage: true,
      email: true,
    },
  })

  if (!customer) return { suspended: false as const }
  if (customer.status !== "SUSPENDED") return { suspended: false as const, customer }

  return {
    suspended: true as const,
    customer,
  }
}
