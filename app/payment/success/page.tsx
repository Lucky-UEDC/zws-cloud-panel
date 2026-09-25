import { redirect } from "next/navigation"
import { prisma } from "@/lib/db"

export default async function PaymentSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ gateway?: string; invoiceId?: string }>
}) {
  const params = await searchParams
  const invoiceId = String(params.invoiceId || "")
  if (invoiceId) {
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: { invoiceNumber: true },
    }).catch(() => null)
    if (invoice?.invoiceNumber) {
      const gateway = params.gateway ? `?payment=success&gateway=${encodeURIComponent(params.gateway)}` : "?payment=success"
      redirect(`/invoice/${encodeURIComponent(invoice.invoiceNumber)}${gateway}`)
    }
  }
  redirect("/client-area/billing")
}
