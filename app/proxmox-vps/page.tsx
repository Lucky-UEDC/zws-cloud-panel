import { redirect } from "next/navigation"

export default function ProxmoxVpsRedirectPage() {
  redirect("/compute-instances")
}
