import { redirect } from "next/navigation"

export default function ProxmoxAdminRedirectPage() {
  redirect("/admin/compute-infrastructure")
}

