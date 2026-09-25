import { prisma } from "@/lib/db"
import { getClientFromCookies } from "@/lib/server-auth"

export async function resolveOtpCustomer(body: any) {
  const client = await getClientFromCookies().catch(() => null)
  if (client?.sub) {
    const customer = await prisma.customer.findUnique({ where: { id: String(client.sub) } })
    if (customer) return customer
  }

  const customerId = typeof body?.customerId === "string" ? body.customerId.trim() : ""
  if (customerId) {
    const customer = await prisma.customer.findUnique({ where: { id: customerId } })
    if (customer) return customer
  }

  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : ""
  if (email) {
    const customer = await prisma.customer.findUnique({ where: { email } })
    if (customer) return customer
  }

  return null
}
