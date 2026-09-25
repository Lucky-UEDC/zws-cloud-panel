import { redirect } from "next/navigation"

export default function LegacyPaymentGatewaysPage() {
  redirect("/admin/payments/gateways")
}
