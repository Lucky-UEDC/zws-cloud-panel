import type { InvoiceViewModel } from "@/lib/invoices/invoice-view-model"
import { formatCurrency } from "@/lib/currency-format"
import Image from "next/image"

function formatDate(value: Date | string | null | undefined) {
  if (!value) return ""
  return new Date(value).toLocaleDateString("en-IN", { year: "numeric", month: "long", day: "numeric" })
}

function formatMoney(value: number, currency = "INR") {
  return formatCurrency(value, currency)
}

function formatPaymentValue(label: string, value: unknown, currency: string) {
  if (value == null) return ""
  if (/paid at/i.test(label)) return formatDate(value as any)
  if (/amount paid/i.test(label)) return formatMoney(Number(value || 0), currency)
  return String(value)
}

const statusStyles: Record<string, string> = {
  paid: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
  pending: "border-amber-400/30 bg-amber-400/10 text-amber-100",
  unpaid: "border-amber-400/30 bg-amber-400/10 text-amber-100",
  sent: "border-sky-400/30 bg-sky-400/10 text-sky-100",
  overdue: "border-red-400/30 bg-red-400/10 text-red-100",
  failed: "border-red-400/30 bg-red-400/10 text-red-100",
  payment_failed: "border-red-400/30 bg-red-400/10 text-red-100",
  cancelled: "border-stone-400/30 bg-stone-400/10 text-stone-200",
  refunded: "border-stone-400/30 bg-stone-400/10 text-stone-200",
}

export function InvoiceDocument({ invoice }: { invoice: InvoiceViewModel }) {
  const statusClass = statusStyles[invoice.status] || "border-stone-400/30 bg-stone-400/10 text-stone-200"

  return (
    <article className="invoice-print-root overflow-hidden rounded-lg border border-border/60 bg-white text-stone-950 shadow-2xl shadow-black/20 print:rounded-none print:border-0 print:shadow-none">
      <header className="border-b border-stone-200 bg-stone-950 px-6 py-6 text-white sm:px-8">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-3">
              {invoice.company.logoUrl ? <Image src={invoice.company.logoUrl} alt="" width={48} height={48} unoptimized className="h-12 w-12 rounded-md bg-white object-contain p-1" /> : null}
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-200">{invoice.company.name}</p>
            </div>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight">{invoice.company.legalName || invoice.company.name}</h2>
            <div className="mt-3 max-w-xl space-y-1 text-sm text-stone-300">
              {invoice.company.address && <p>{invoice.company.address}</p>}
              {invoice.company.registrationNumber && <p>Registration: {invoice.company.registrationNumber}</p>}
              {invoice.company.gstin && <p>GSTIN: {invoice.company.gstin}</p>}
              {invoice.company.vatNumber && !invoice.company.gstin && <p>VAT: {invoice.company.vatNumber}</p>}
              <p>{invoice.company.email}</p>
            </div>
          </div>
          <div className="sm:text-right">
            <h1 className="text-3xl font-semibold tracking-tight">{invoice.title}</h1>
            <p className="mt-2 font-mono text-sm text-stone-300">{invoice.invoiceNumber}</p>
            <span className={`mt-4 inline-flex rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide ${statusClass}`}>
              {invoice.status.replace(/_/g, " ")}
            </span>
          </div>
        </div>
      </header>

      <section className="grid gap-6 border-b border-stone-200 px-6 py-6 sm:grid-cols-[1.2fr_0.8fr] sm:px-8">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">Bill To</p>
          <div className="mt-3 space-y-1 text-sm text-stone-700">
            <p className="text-base font-semibold text-stone-950">{invoice.customer.name}</p>
            {invoice.customer.company && <p>{invoice.customer.company}</p>}
            <p>{invoice.customer.email}</p>
            {invoice.customer.phone && <p>{invoice.customer.phone}</p>}
            {invoice.customer.addressLines.map((line) => <p key={line}>{line}</p>)}
            {invoice.customer.gstin && <p>GSTIN: {invoice.customer.gstin}</p>}
          </div>
        </div>
        <dl className="grid content-start gap-3 text-sm">
          <InvoiceMeta label="Invoice date" value={formatDate(invoice.issueDate)} />
          <InvoiceMeta label="Due date" value={formatDate(invoice.dueDate)} />
          {invoice.orderNumber && <InvoiceMeta label="Order ID" value={invoice.orderNumber} mono />}
          {invoice.paidAt && <InvoiceMeta label="Paid at" value={formatDate(invoice.paidAt)} />}
        </dl>
      </section>

      <section className="px-6 py-6 sm:px-8">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-stone-300 text-left text-xs uppercase tracking-wide text-stone-500">
                <th className="pb-3 font-semibold">Description</th>
                <th className="pb-3 text-center font-semibold">Qty</th>
                <th className="pb-3 text-center font-semibold">Term</th>
                <th className="pb-3 text-right font-semibold">Unit price</th>
                <th className="pb-3 text-right font-semibold">Amount</th>
              </tr>
            </thead>
            <tbody>
              {invoice.lineItems.map((item, index) => (
                <tr key={`${item.description}-${index}`} className="border-b border-stone-200 align-top">
                  <td className="py-4 pr-4">
                    <p className="font-semibold text-stone-950">{item.description}</p>
                    {item.meta.length > 0 && <p className="mt-1 text-xs text-stone-500">{item.meta.join(" · ")}</p>}
                  </td>
                  <td className="py-4 text-center">{item.quantity}</td>
                  <td className="py-4 text-center">{item.termMonths} {item.termMonths === 1 ? "month" : "months"}</td>
                  <td className="py-4 text-right font-mono">{formatMoney(item.unitPrice, invoice.currency)}</td>
                  <td className="py-4 text-right font-mono font-semibold">{formatMoney(item.total, invoice.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-6 flex justify-end">
          <div className="w-full max-w-sm space-y-2 text-sm">
            <TotalRow label="Subtotal" value={formatMoney(invoice.subtotal, invoice.currency)} />
            {invoice.discountAmount > 0 && <TotalRow label="Discount" value={`-${formatMoney(invoice.discountAmount, invoice.currency)} (${invoice.discountPercent.toFixed(1)}% OFF)`} tone="success" />}
            <TotalRow label="Taxable amount" value={formatMoney(invoice.taxableAmount, invoice.currency)} />
            <TotalRow label={`${invoice.taxLabel || "Tax"} (${invoice.taxRate}%)`} value={formatMoney(invoice.taxAmount, invoice.currency)} />
            <div className="flex justify-between border-t border-stone-300 pt-3 text-lg font-semibold">
              <span>Total</span>
              <span className="font-mono">{formatMoney(invoice.totalAmount, invoice.currency)}</span>
            </div>
          </div>
        </div>

        {invoice.paymentRows.length > 0 && (
          <section className="mt-8 rounded-md border border-stone-200 bg-stone-50 p-4">
            <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">Payment Details</h3>
            <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
              {invoice.paymentRows.map((row) => (
                <InvoiceMeta key={row.label} label={row.label} value={formatPaymentValue(row.label, row.value, invoice.currency)} />
              ))}
            </dl>
          </section>
        )}

        {invoice.notes && (
          <section className="mt-8 rounded-md border border-stone-200 bg-stone-50 p-4 text-sm text-stone-700">
            <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">Notes</h3>
            <p className="mt-2">{invoice.notes}</p>
          </section>
        )}
      </section>

      <footer className="border-t border-stone-200 px-6 py-5 text-center text-xs text-stone-500 sm:px-8">
        <p>{invoice.company.invoiceFooterText || `Thank you for choosing ${invoice.company.name}. This invoice was generated electronically.`}</p>
        <p className="mt-1">
          Support: {invoice.company.supportEmail || invoice.company.email}
          {invoice.company.phone ? ` · ${invoice.company.phone}` : ""}
          {invoice.company.website ? ` · ${invoice.company.website}` : ""}
        </p>
      </footer>
    </article>
  )
}

function InvoiceMeta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-4 border-b border-stone-200 pb-2 last:border-b-0">
      <dt className="text-stone-500">{label}</dt>
      <dd className={`text-right font-medium text-stone-900 ${mono ? "font-mono text-xs" : ""}`}>{value}</dd>
    </div>
  )
}

function TotalRow({ label, value, tone }: { label: string; value: string; tone?: "success" }) {
  return (
    <div className={`flex justify-between ${tone === "success" ? "text-emerald-700" : "text-stone-700"}`}>
      <span>{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  )
}
