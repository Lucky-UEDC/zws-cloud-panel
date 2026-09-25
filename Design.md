# ZWS Cloud Panel Design

## Product Shape

ZWS Cloud Panel is an operational hosting control panel, not a marketing-only site. Interfaces should prioritize clarity, fast scanning, safe actions, and accurate system state.

## Public Surface

- Product catalog and category pages should look premium but remain direct.
- Checkout should stay focused, breadcrumb-free, and stable after first load.
- Offer pages should use premium cloud-provider style presentation with clear price and platform choices.
- Dedicated server pages should support real booking and payment, not inquiry-only flows.

## Client Area

- VPS detail should show live status, resources, storage, console access, invoices, actions, activity, and maintenance paths.
- CPU/RAM upgrades should create an upgrade order and redirect to payment.
- Disk upgrades belong on the dedicated disk upgrade page.
- Reinstall should show OS/platform choices from the same availability source as checkout/provisioning.
- Wallet top-up and wallet payment should be explicit, not implied split payment.

## Admin Area

- Admin pages should be dense, quiet, and operational.
- Settings should not duplicate domain gateway credential editing.
- Payment, email, Proxmox, OS templates, storage pools, IP pools, products, invoices, orders, and revenue need clear state and safe actions.
- Exact safe error codes are preferred over generic failure copy.

## Interaction Rules

- Avoid full-page reloads during checkout edits.
- Use document navigation only for final submit, login, or payment transitions.
- Only explicit logout should clear sessions.
- Confirmation and destructive actions need clear state and audit trails.

## Visual Rules

- Use restrained cards for repeated items, dialogs, and tools.
- Avoid nested cards and decorative backgrounds that reduce readability.
- Buttons should use clear commands and icons where useful.
- Form controls should remain selectable; do not apply `select-none` to inputs or dropdowns.
- Text must fit on mobile and desktop without overlapping controls.

## Payment UX

- Show wallet and gateway as explicit choices where both apply.
- Redirect gateway payments immediately after backend start.
- Wallet-paid success should move directly to status/service context.
- Failed payment starts must show actionable inline errors.

## Provisioning UX

- Show real current step and friendly customer-safe messages.
- Failed provisioning should say support action is needed without exposing secrets.
- Admin logs should retain technical detail and safe failure codes.
