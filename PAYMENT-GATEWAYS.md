# Payment Gateways

ZWS Cloud supports wallet payments, Cashfree, PhonePe, manual payment mode, and test/mock modes.

## Source Of Truth

- Domain-aware gateway resolution lives in `lib/payments/domain-gateway-resolver.ts`.
- Gateway credentials are configured through domain gateway admin screens.
- Legacy global settings should not be used for new payment runtime decisions.

## Payment Flow

1. Backend validates identity, billing/profile state, pricing, wallet choice, and gateway availability.
2. Gateway starts create pending payment state only.
3. Webhook or status reconciliation verifies gateway success.
4. Shared paid finalization marks payment/invoice/order paid and triggers the correct side effect.
5. Provisioning or delivery runs only after paid finalization.

## Wallet

- Wallet is an all-or-gateway choice.
- Wallet payment is allowed only when balance covers the full payable amount.
- Wallet settlement marks payment and invoice paid immediately.
- Wallet-paid VPS orders, dedicated orders, disk upgrades, CPU/RAM upgrades, and renewals must route through the same finalization path.

## Cashfree

- Cashfree SDK checkout uses `paymentSessionId` when available.
- Redirect URL remains a fallback if SDK startup fails.
- CSP must allow Cashfree script/frame/form endpoints.
- Webhooks require raw body signature validation and amount/currency checks.

## PhonePe

- PhonePe may use bridge flows for approved payment domains.
- Bridge/webhook routes must not depend on a ZWS login cookie from another root domain.
- Webhook verification and status reconciliation must update payment attempts before finalization.

## Upgrade Payments

CPU/RAM VPS upgrades use `purpose: "upgrade_order"` and an existing upgrade order ID.

- Gateway: redirect to gateway; webhook/reconciliation queues upgrade after success.
- Wallet: debit wallet; mark invoice paid; queue upgrade immediately.
- Duplicate success events must not queue duplicate upgrade jobs.

## Troubleshooting

- `NO_GATEWAY_AVAILABLE`: configure an enabled domain gateway with credentials.
- `PAYMENT_INIT_FAILED`: inspect gateway attempt logs and provider response.
- Amount mismatch: compare stored expected payment amount with webhook amount.
- Pending payment stuck: use payment status reconciliation before manual marking.
