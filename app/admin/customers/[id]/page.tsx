import CustomerDetailsClient from "./CustomerDetailsClient"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

export default async function AdminCustomerDetailsPage() {
  return <CustomerDetailsClient />
}
