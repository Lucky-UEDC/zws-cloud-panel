import type { InvoiceViewModel } from "@/lib/invoices/invoice-view-model"
import { formatCurrency } from "@/lib/currency-format"

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

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

const pdfStatusStyles: Record<string, string> = {
  paid: "invoice-pdf-status invoice-pdf-status-paid",
  pending: "invoice-pdf-status invoice-pdf-status-pending",
  unpaid: "invoice-pdf-status invoice-pdf-status-pending",
  sent: "invoice-pdf-status invoice-pdf-status-pending",
  overdue: "invoice-pdf-status invoice-pdf-status-danger",
  failed: "invoice-pdf-status invoice-pdf-status-danger",
  payment_failed: "invoice-pdf-status invoice-pdf-status-danger",
  cancelled: "invoice-pdf-status invoice-pdf-status-muted",
  canceled: "invoice-pdf-status invoice-pdf-status-muted",
  refunded: "invoice-pdf-status invoice-pdf-status-muted",
  void: "invoice-pdf-status invoice-pdf-status-muted",
  draft: "invoice-pdf-status invoice-pdf-status-draft",
}

function metaRow(label: string, value: string, mono = false) {
  return `
    <div class="invoice-pdf-meta">
      <dt>${escapeHtml(label)}</dt>
      <dd${mono ? ` class="invoice-pdf-mono"` : ""}>${escapeHtml(value)}</dd>
    </div>`
}

function totalRow(label: string, value: string, tone?: "success") {
  const className = tone === "success" ? "invoice-pdf-total-row invoice-pdf-total-success" : "invoice-pdf-total-row"
  return `
    <div class="${className}">
      <span>${escapeHtml(label)}</span>
      <span>${escapeHtml(value)}</span>
    </div>`
}

export function renderInvoicePdfTemplate(invoice: InvoiceViewModel) {
  const statusClass = pdfStatusStyles[invoice.status] || "invoice-pdf-status invoice-pdf-status-muted"
  const logo = invoice.company.logoUrl
    ? `<img src="${escapeHtml(invoice.company.logoUrl)}" alt="${escapeHtml(invoice.company.name)} logo" class="invoice-pdf-logo" />`
    : `<div class="invoice-pdf-logo-mark">Z</div>`
  const companyAddress = [
    invoice.company.address,
    invoice.company.registrationNumber ? `Registration: ${invoice.company.registrationNumber}` : null,
    invoice.company.gstin ? `GSTIN: ${invoice.company.gstin}` : null,
    invoice.company.vatNumber && !invoice.company.gstin ? `VAT: ${invoice.company.vatNumber}` : null,
    invoice.company.email,
  ].filter(Boolean).map((line) => `<p>${escapeHtml(line)}</p>`).join("")
  const customerAddress = [
    invoice.customer.company,
    invoice.customer.email,
    invoice.customer.phone,
    ...invoice.customer.addressLines,
    invoice.customer.gstin ? `GSTIN: ${invoice.customer.gstin}` : null,
  ].filter(Boolean).map((line) => `<p>${escapeHtml(line)}</p>`).join("")
  const metaRows = [
    metaRow("Invoice date", formatDate(invoice.issueDate)),
    metaRow("Due date", formatDate(invoice.dueDate)),
    invoice.orderNumber ? metaRow("Order ID", invoice.orderNumber, true) : "",
    invoice.paidAt ? metaRow("Paid at", formatDate(invoice.paidAt)) : "",
  ].join("")
  const lineItems = invoice.lineItems.map((item) => `
    <tr>
      <td>
        <p class="invoice-pdf-item-title">${escapeHtml(item.description)}</p>
        ${item.meta.length > 0 ? `<p class="invoice-pdf-item-meta">${escapeHtml(item.meta.join(" · "))}</p>` : ""}
      </td>
      <td>${escapeHtml(item.quantity)}</td>
      <td>${escapeHtml(item.termMonths)} ${item.termMonths === 1 ? "month" : "months"}</td>
      <td class="invoice-pdf-money">${escapeHtml(formatMoney(item.unitPrice, invoice.currency))}</td>
      <td class="invoice-pdf-money invoice-pdf-strong">${escapeHtml(formatMoney(item.total, invoice.currency))}</td>
    </tr>`).join("")
  const paymentRows = invoice.paymentRows.map((row) => metaRow(row.label, formatPaymentValue(row.label, row.value, invoice.currency))).join("")
  const supportLine = [
    `Support: ${invoice.company.supportEmail || invoice.company.email}`,
    invoice.company.phone,
    invoice.company.website,
  ].filter(Boolean).join(" · ")

  return `
    <main class="invoice-pdf-page">
      <article class="invoice-pdf-document">
        <header class="invoice-pdf-header">
          <div class="invoice-pdf-header-accent"></div>
          <div class="invoice-pdf-company">
            <div class="invoice-pdf-brand-row">
              ${logo}
              <div>
                <p class="invoice-pdf-brand-name">${escapeHtml(invoice.company.name)}</p>
                <p class="invoice-pdf-brand-subtitle">Cloud infrastructure billing</p>
              </div>
            </div>
            <h2 class="invoice-pdf-legal-name">${escapeHtml(invoice.company.legalName || invoice.company.name)}</h2>
            <div class="invoice-pdf-company-address">${companyAddress}</div>
          </div>
          <div class="invoice-pdf-heading">
            <h1>${escapeHtml(invoice.title)}</h1>
            <p>${escapeHtml(invoice.invoiceNumber)}</p>
            <span class="${statusClass}">${escapeHtml(invoice.status.replace(/_/g, " "))}</span>
          </div>
        </header>

        <section class="invoice-pdf-billing">
          <div class="invoice-pdf-bill-to">
            <p class="invoice-pdf-kicker">Bill To</p>
            <div class="invoice-pdf-address-block">
              <p class="invoice-pdf-customer-name">${escapeHtml(invoice.customer.name)}</p>
              ${customerAddress}
            </div>
          </div>
          <dl class="invoice-pdf-meta-list">${metaRows}</dl>
        </section>

        <section class="invoice-pdf-body">
          <div class="invoice-pdf-table-wrap">
            <table class="invoice-pdf-table">
              <colgroup>
                <col class="invoice-pdf-col-description" />
                <col class="invoice-pdf-col-qty" />
                <col class="invoice-pdf-col-term" />
                <col class="invoice-pdf-col-price" />
                <col class="invoice-pdf-col-amount" />
              </colgroup>
              <thead>
                <tr>
                  <th>Description</th>
                  <th>Qty</th>
                  <th>Term</th>
                  <th>Unit price</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>${lineItems}</tbody>
            </table>
          </div>

          <div class="invoice-pdf-totals-row">
            <div class="invoice-pdf-totals">
              ${totalRow("Subtotal", formatMoney(invoice.subtotal, invoice.currency))}
              ${invoice.discountAmount > 0 ? totalRow("Discount", `-${formatMoney(invoice.discountAmount, invoice.currency)} (${invoice.discountPercent.toFixed(1)}% OFF)`, "success") : ""}
              ${totalRow("Taxable amount", formatMoney(invoice.taxableAmount, invoice.currency))}
              ${totalRow(`${invoice.taxLabel || "GST"} (${invoice.gstPercent ?? invoice.taxRate}%)`, formatMoney(invoice.gstAmount ?? invoice.taxAmount, invoice.currency))}
              <div class="invoice-pdf-grand-total">
                <span>Grand Total</span>
                <span>${escapeHtml(formatMoney(invoice.totalAmount, invoice.currency))}</span>
              </div>
            </div>
          </div>

          ${invoice.paymentRows.length > 0 ? `
            <section class="invoice-pdf-card">
              <h3>Payment Details</h3>
              <dl class="invoice-pdf-payment-grid">${paymentRows}</dl>
            </section>` : ""}

          ${invoice.notes ? `
            <section class="invoice-pdf-card invoice-pdf-notes">
              <h3>Notes</h3>
              <p>${escapeHtml(invoice.notes)}</p>
            </section>` : ""}
        </section>

        <footer class="invoice-pdf-footer">
          <p>${escapeHtml(invoice.company.invoiceFooterText || `Thank you for choosing ${invoice.company.name}. This invoice was generated electronically.`)}</p>
          <p>${escapeHtml(supportLine)}</p>
        </footer>
      </article>
    </main>`
}
