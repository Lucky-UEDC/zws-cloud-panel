export {
  resolvePaymentGateway,
  resolveGatewayForPayment,
  listEnabledGatewaysForRequest,
} from "@/lib/payments/domain-gateway-resolver"
export type { GatewayName, ResolvedPaymentGateway as GatewayResolution } from "@/lib/payments/domain-gateway-resolver"
