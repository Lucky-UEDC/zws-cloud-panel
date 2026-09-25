import { verifyDomainGatewayWebhookRawBody } from "@/lib/payment-gateways"

export function verifyPaymentWebhook(input: {
  gateway: "cashfree" | "phonepe" | "razorpay"
  rawBody: string
  headers: Headers
  gatewayConfig: any
}) {
  return verifyDomainGatewayWebhookRawBody(input.gateway, input.rawBody, input.headers, input.gatewayConfig)
}
