import { redirect } from "next/navigation"

export default function LegacyClientInvoicesRedirect() {
  redirect("/client-area/billing")
}
