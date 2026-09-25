import { InvoiceActions } from "@/components/invoice/invoice-actions"
import { InvoiceDocument } from "@/components/invoice/invoice-document"
import type { InvoiceViewModel } from "@/lib/invoices/invoice-view-model"

export function InvoiceView({
  invoice,
  downloadUrl,
  payUrl,
  printLogUrl,
  showActions = true,
}: {
  invoice: InvoiceViewModel
  downloadUrl: string
  payUrl?: string | null
  printLogUrl?: string | null
  showActions?: boolean
}) {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 lg:px-8 print:max-w-none print:p-0">
      <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between print:hidden">
        <div>
          <p className="text-sm text-muted-foreground">Billing</p>
          <h1 className="text-2xl font-semibold tracking-tight">Invoice {invoice.invoiceNumber}</h1>
        </div>
        {showActions && (
          <InvoiceActions
            invoiceId={invoice.id}
            canPay={invoice.canPay}
            downloadUrl={downloadUrl}
            payUrl={payUrl}
            printLogUrl={printLogUrl}
          />
        )}
      </div>
      <InvoiceDocument invoice={invoice} />
    </div>
  )
}

