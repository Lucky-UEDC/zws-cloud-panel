import { redirect } from "next/navigation"

export default function LegacyCreateOrderPage() {
  redirect("/admin/orders/new")
}

