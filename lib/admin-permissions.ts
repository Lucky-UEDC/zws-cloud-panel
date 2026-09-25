export const PAYMENT_PERMISSIONS = {
  gatewayManage: "payment.gateway.manage",
  gatewayTest: "payment.gateway.test",
  webhookView: "payment.webhook.view",
  invoiceEdit: "payment.invoice.edit",
} as const

export function canManagePaymentGateways(admin: { role?: string | null } | null | undefined) {
  return admin?.role === "admin" || admin?.role === "super_admin"
}
