import { redirect } from "next/navigation"

export default function ProxmoxNodesRedirectPage() {
  redirect("/admin/compute-nodes")
}

