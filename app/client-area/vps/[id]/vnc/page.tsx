"use client"

import Link from "next/link"
import { useParams } from "next/navigation"
import { Button } from "@/components/ui/button"

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

export default function LegacyVncPage() {
  const params = useParams()
  const id = firstParam(params?.id)
  return (
    <div className="rounded-xl border border-border/40 bg-background/60 p-6 text-center">
      <p className="text-lg font-medium">Console access is temporarily unavailable.</p>
      <Button className="mt-4" asChild>
        <Link href={`/client-area/vps/${id}`}>Back to instance</Link>
      </Button>
    </div>
  )
}
