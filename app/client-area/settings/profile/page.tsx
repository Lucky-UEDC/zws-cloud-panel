import { redirect } from "next/navigation"

export default async function ClientSettingsProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ missing?: string; return?: string }>
}) {
  const params = await searchParams
  const query = new URLSearchParams()
  if (params?.missing) query.set("missing", params.missing)
  if (params?.return) query.set("return", params.return)
  const suffix = query.toString()
  redirect(`/client-area/settings${suffix ? `?${suffix}` : ""}#billing-address`)
}
