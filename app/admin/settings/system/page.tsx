import { redirect } from "next/navigation"

export default function LegacySystemSettingsPage() {
  redirect("/admin/settings")
}
