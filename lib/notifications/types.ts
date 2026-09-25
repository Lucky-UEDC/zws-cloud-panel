import type { EmailTemplateVariables } from "@/lib/email/templates"

export type NotificationType = "otp" | "order" | "login" | "notification" | "auth" | "invoice" | "server" | "support" | "marketing"
export type NotificationChannel = "email" | "whatsapp"

export type NotificationUser = {
  id?: string | null
  email?: string | null
  phone?: string | null
  name?: string | null
}

export type NotificationData = EmailTemplateVariables & {
  templateKey?: string
  subject?: string
  text?: string
  html?: string
  message?: string
  orderId?: string | null
  order_id?: string | null
  orderNumber?: string | null
  invoiceId?: string | null
  invoice_id?: string | null
  invoice_due?: string | null
  invoice_total?: string | null
  payment_link?: string | null
  paymentUrl?: string | null
  vpsInstanceId?: string | null
  deployment_stage?: string | null
  payment_status?: string | null
  customer_name?: string | null
  server_name?: string | null
  ip_address?: string | null
  monthly_cost?: string | null
  renewal_date?: string | null
  plan?: string | null
  slots?: string | null
  schedule?: string | null
  dashboard_url?: string | null
  dashboardUrl?: string | null
  status?: string | null
  metadata?: Record<string, unknown>
  skipRegistrationCheck?: boolean
}

export type SendNotificationInput = {
  user: NotificationUser
  type: NotificationType
  channels?: NotificationChannel[]
  data?: NotificationData
}

export type ChannelResult = {
  ok: boolean
  status: "sent" | "queued" | "delivered" | "read" | "played" | "failed" | "skipped"
  messageId?: string | null
  toMasked?: string
  ack?: number | null
  deliveryStatus?: string | null
  error?: string
  code?: string
}

export type NotificationResult = {
  ok: boolean
  status: "success" | "partial_success" | "failed"
  type: NotificationType
  channels: Partial<Record<NotificationChannel, ChannelResult>>
}
