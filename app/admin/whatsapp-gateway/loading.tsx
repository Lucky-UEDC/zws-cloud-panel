import type { Metadata } from "next"
import { Skeleton } from "@/components/ui/skeleton"

export const metadata: Metadata = {
  title: "Loading WhatsApp Gateway | Admin Dashboard",
  robots: "noindex, nofollow",
}

export default function AdminWhatsAppGatewayLoading() {
  return (
    <div className="space-y-6">
      <div className="flex gap-2 overflow-x-auto pb-1">
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton key={index} className="h-9 w-28 shrink-0 rounded-md" />
        ))}
      </div>
      <Skeleton className="h-96 w-full" />
    </div>
  )
}