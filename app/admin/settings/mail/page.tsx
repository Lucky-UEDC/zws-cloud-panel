import { redirect } from "next/navigation"

export default function LegacyMailSettingsPage() {
  redirect("/admin/email/smtp")
}
