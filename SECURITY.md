# Security

## Secrets

- Never commit `.env`, private keys, dumps, logs, database backups, or real credentials.
- `.env.example` must contain placeholders only.
- Rotate secrets after host, repository, token, or staff access incidents.
- Do not print payment, SMTP, session, or Proxmox token secrets in logs.

## Authentication

- Logout must be explicit.
- Expired or invalid sessions must return `session_expired` with `Session expired. Please login again.` and clear stale auth cookies without redirect loops.
- Production cookies should be host-only and secure.
- Admin-only overrides should leave audit evidence.

## Payments

- Backend owns final pricing and paid state.
- Gateway webhooks require signature verification, raw-body handling, idempotency, and amount/currency checks.
- Pending gateway payments must not trigger provisioning.
- Wallet payment requires full wallet coverage.

## Infrastructure

- Proxmox tokens must stay server-side.
- TCP reachability to Proxmox port `8006` must be verified from the app host.
- CSP and same-origin protections should be rolled out carefully and tested after changes.

## Reporting

Report security issues privately to the repository owner. Include impact, reproduction steps, affected route/API, and relevant timestamps without secrets.
