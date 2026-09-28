# Product Roadmap

This branch tracks the product roadmap and planning documents for the UltraEdge Datacenter Platform. It is not used for production code — all shipped code lands on `main` (stable) and `next` (integration).

## Status Legend

- ✅ Shipped — live in production
- 🔄 In progress — actively developed
- ⏳ Planned — scoped, not started
- 💡 Idea — under consideration

---

## Phase 1 — Foundations (shipped ✅)

- ✅ VPS provisioning lifecycle (order → payment → provision → delivery → renew → terminate)
- ✅ Payment contracts: order/invoice/payment consistency, one-order-one-vm rule
- ✅ Payment gateways: Razorpay, Cashfree, PhonePe with runtime credentials
- ✅ Explicit gateway selection (customer choice always wins; priority only for automatic routing; failsafe fallback never silent)
- ✅ WhatsApp gateway (Evolution API) with OTP, transactional delivery, and message lifecycle observability
- ✅ Admin RBAC, audit log, panel logs

## Phase 2 — VM Backup Service (shipped ✅)

- ✅ Backup plans, subscriptions, quota (100 GB class), overage pricing, run guards
- ✅ Snapshot-mode vzdump backups with compression, scheduler policies, retention (flip-to-cancelled at retention ceiling)
- ✅ Storage-side verification before a backup may claim success (volume exists / size / storage list / timestamp)
- ✅ Backup usage ledger and overage reconciliation (DB-only, never scans storage)
- ✅ Customer lifecycle notifications (email + WhatsApp, durable dedupe)
- ✅ Manual restore flows with merge-first + rollback metadata

## Phase 3 — Production Hardening (shipped ✅)

- ✅ Dockerized deployment (`docker compose`, migrate-before-boot gate)
- ✅ Immutable image tagging (source-fingerprint + semver + digest)
- ✅ Runtime build-info endpoint (version / commit / built-at)
- ✅ Client-side infra leak removal (no node names, UPIDs, or paths to customers)
- ✅ Client backup page hardening: self-service delete (artifact-first, usage recalc, audit trail), friendly label/IP selector (no internal vmId), error≠empty UI, no artifact path/fileName exposure
- ✅ Server Tag identity (`displayTag`): customer-managed display name end-to-end (checkout → list → detail → backups), hostname auto-derived from public IP and never customer-editable
- ✅ Account Credit wallet payments in checkout: credit default when it covers payable, atomic exact/insufficient debit, credit path never opens a payment gateway
- ✅ Vulnerability-ish gaps closed: gateway mismatch detection, run guards, entitlement checks on every backup start

## Phase 4 — Update Center (shipped ✅)

- ✅ Trusted release source on GitHub (private repo, raw fetch with token)
- ✅ Strict release-manifest validation (semver, image prefix, sha256 digest, migration names)
- ✅ Apply workflow: fixed script only, Redis lock, `Deployment` lifecycle ledger
- ✅ Admin System → Updates UI (list releases / history / apply)
- ✅ CI workflow (typecheck, lint, tests)

## Phase 5 — Next (roadmap 🔄 / ⏳)

- 🔄 Self-service VM rescue console (boot iso / single-user mode) — design drafted
- ⏳ Scheduled auto-scaling for burst workloads
- ⏳ Cross-region replicated backup destinations
- ⏳ Usage-based billing exports (invoice-level itemization per VM)
- 💡 Public status page with incident timeline
- 💡 Terraform provider for the panel API
- 💡 Multi-tenant role scoping (reseller accounts)

## Phase 6 — Long-term spans

- 📈 99.99% uptime SLO tracking with external synthetic monitoring
- 🔄 Zero-downtime migrations (additive-only enforcement in CI)
- 🔄 Disaster recovery drills on a schedule (restore from backup in staging)
- 💡 Edge worker node fleet management portal

---

## How We Ship

1. Work happens on short-lived branches off `next`.
2. Every change requires `pnpm typecheck`, `pnpm lint`, `pnpm test`, and a successful image build.
3. Schema changes are additive-only and applied via the Compose `migrate` service.
4. A release is a semver tag + `release-manifest.json`; internal app version may differ from the published tag (e.g., v0.0.1 = internal 1.1.0).
5. Production deploys are Docker-first (`docker compose up -d --build --remove-orphans`).

See `CONTRIBUTING.md`, `AGENTS.md`, and `DEPLOYMENT.md` on `main` for details.