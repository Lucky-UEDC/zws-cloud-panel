import { redirect } from "next/navigation"

export default async function UsageRedirectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  redirect(`/client-area/vps/${id}`)
}
