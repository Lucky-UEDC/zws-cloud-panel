import Link from "next/link"
import { Button } from "@/components/ui/button"

export default function PaymentCancelPage() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-xl flex-col justify-center px-6 py-16">
      <h1 className="text-3xl font-semibold">Payment cancelled</h1>
      <p className="mt-3 text-sm text-muted-foreground">Your invoice is still unpaid. You can retry the payment from billing.</p>
      <div className="mt-6 flex gap-3">
        <Button asChild><Link href="/client-area/billing">Open billing</Link></Button>
        <Button asChild variant="outline"><Link href="/checkout">Return to checkout</Link></Button>
      </div>
    </main>
  )
}
