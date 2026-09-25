export function formatCurrency(value: unknown, currency = "INR", locale?: string | null) {
  void currency
  const amount = Number(value || 0)
  return new Intl.NumberFormat(locale || "en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: Number.isInteger(amount) ? 0 : 2,
  }).format(Number.isFinite(amount) ? amount : 0)
}
