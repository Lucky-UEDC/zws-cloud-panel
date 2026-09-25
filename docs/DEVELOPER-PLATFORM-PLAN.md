# MyRDPHub Developer Platform — Reseller API, Client API, WHMCS Module & Docs Site
Design + build plan for `doc.myrdphub.com`. Status: **planning/architecture** (nothing built yet — no `ApiKey`
model, no `/api/reseller`, no WHMCS module exist today). This doc is the "detailed planning + best-of-best" pick.

## 0. Recommendation (best of best) — TL;DR
1. **One versioned REST API** under `/api/v1/*` with **API-key auth** + **scopes** + **per-key rate limits**.
   - **Reseller keys** (full: manage clients, provision, lifecycle, billing hooks) and **Client keys** (scoped to
     one customer's own resources). Same endpoints, different scope — avoids duplicate code.
2. **WHMCS "server/provisioning module"** (PHP) that is a thin client of the reseller API — no business logic in PHP.
3. **Docs site: Nextra** (Next.js + MDX) — matches the existing stack, deploys to Cloudflare Pages at
   `doc.myrdphub.com`, supports OpenAPI rendering. (Docusaurus is the runner-up.)
4. **Publish an OpenAPI 3.1 spec** as the single source of truth → auto-generate docs + SDKs + the WHMCS client.

## 1. Reseller / Client API (`/api/v1`)
**Auth:** `Authorization: Bearer rk_live_…`. New Prisma model:
```
model ApiKey {
  id String @id @default(cuid())
  name String
  prefix String            // shown in UI, e.g. rk_live_ab12
  hashedKey String @unique // sha256(secret) — never store raw
  type String              // "reseller" | "client"
  ownerCustomerId String?  // client keys are scoped to this customer
  scopes String[]          // ["vm:read","vm:write","vm:reinstall","billing:read", …]
  rateLimitPerMin Int @default(120)
  lastUsedAt DateTime?
  expiresAt DateTime?
  revokedAt DateTime?
  createdAt DateTime @default(now())
  @@index([hashedKey])
}
```
**Verification helper** `lib/api/auth.ts`: hash the presented key → look up `ApiKey` (not revoked/expired) → attach
`{ownerCustomerId, scopes, type}` to the request → enforce scope per route → `checkSecurityRateLimit` per key.

**Endpoints (reuse existing libs — do NOT reimplement provisioning):**
| Method | Path | Scope | Reuses |
|---|---|---|---|
| GET | `/api/v1/products` | `catalog:read` | `lib/public-products.ts` |
| GET | `/api/v1/vms` | `vm:read` | `lib/admin-vm-query.ts` / `lib/vm-db-truth.ts` |
| POST | `/api/v1/vms` | `vm:write` | order+`enqueueProvisioningJob` (lib/provision.ts) |
| GET | `/api/v1/vms/{id}` | `vm:read` | `lib/proxmox-live.ts` (live status) |
| POST | `/api/v1/vms/{id}/power` | `vm:write` | `performVpsPowerAction` (lib/vps-control.ts) |
| POST | `/api/v1/vms/{id}/reinstall` | `vm:reinstall` | `enqueueReinstallJob` (lib/provision.ts) |
| DELETE | `/api/v1/vms/{id}` | `vm:delete` | `requestVmDeletion` (lib/vm-deletion.ts) |
| GET | `/api/v1/vms/{id}/console` | `vm:console` | `lib/console-session.ts` |
| GET | `/api/v1/invoices` / `/clients` (reseller only) | `billing:read`/`client:read` | existing admin libs |
| POST | `/api/v1/webhooks` | reseller | new — subscribe to events |

**Client keys** = the same routes but forced `ownerCustomerId` filter (a customer only sees their own VMs).
**Webhooks (outbound):** reuse `lib/outbound-event-delivery.ts` to POST `vm.provisioned/reinstalled/suspended/…`
to reseller URLs with an HMAC signature. This is exactly what a WHMCS module needs for async status.

**Rate limits:** per-key (`ApiKey.rateLimitPerMin`) via `checkSecurityRateLimit` + Cloudflare edge rules.

## 2. WHMCS Server/Provisioning Module (`whmcs-module/servers/myrdphub/`)
A WHMCS "server module" (PHP) implementing the standard function hooks, each a thin call to `/api/v1`:
- `myrdphub_ConfigOptions()` — plan/product mapping, region, OS template.
- `myrdphub_CreateAccount($params)` → `POST /api/v1/vms` (idempotent via WHMCS serviceid).
- `myrdphub_SuspendAccount` / `_UnsuspendAccount` → `POST /vms/{id}/power` (stop/start) or suspend endpoint.
- `myrdphub_TerminateAccount` → `DELETE /vms/{id}`.
- `myrdphub_ChangePackage` (upgrade/downgrade), `_Reinstall`, `_ClientArea` (single-sign-on console link).
- `myrdphub_TestConnection` → `GET /api/v1/products` with the reseller key.
- Server config: API base URL + reseller API key (stored in WHMCS server "password" field).
**Full module-create process** (documented on the site): scaffold dir, `module.php` hooks, config options,
custom fields (vmid/ip), client-area template, test-connection, packaging as a `.zip` for WHMCS Addons.

## 3. Docs site — `doc.myrdphub.com`
- **Stack: Nextra** (Next.js + MDX). Separate app in `docs-site/` (or a Cloudflare Pages project).
- **Deploy:** Cloudflare Pages, custom domain `doc.myrdphub.com` (CNAME) — free, edge-cached, matches the CF setup.
- **Structure:** Getting Started · Authentication (API keys/scopes) · Reseller API reference (from OpenAPI) ·
  Client API · Webhooks · WHMCS Module (install + configure + build-your-own) · Rate limits · Changelog.
- **Source of truth:** an OpenAPI 3.1 file (`openapi/myrdphub.yaml`) → render with a Nextra OpenAPI plugin, and
  generate the WHMCS client + TS/PHP SDKs from it.

## 4. Build order (incremental, each shippable)
1. `ApiKey` model + `lib/api/auth.ts` (key hash/verify/scope/rate-limit) + admin UI to create/revoke keys.
2. `/api/v1/vms` (list/get/create) + `/power` + `/reinstall` + `/delete` (thin wrappers over existing libs).
3. OpenAPI spec + webhooks (HMAC) via `outbound-event-delivery`.
4. WHMCS module (PHP) calling the above; test with a WHMCS sandbox.
5. Nextra docs site + Cloudflare Pages `doc.myrdphub.com`.

## 5. Security (ties to SECURITY-AUDIT-2026-07-02.md)
API keys hashed at rest; scopes least-privilege; per-key + Cloudflare rate limits; keys revocable + expiring;
audit every API-key action via `createAuditLog`; client keys hard-scoped to `ownerCustomerId`.
