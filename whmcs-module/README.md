# MyRDPHub — WHMCS Server Module

Thin WHMCS provisioning module for the MyRDPHub cloud panel. All logic lives in the panel; this module
only maps WHMCS lifecycle hooks to the versioned `/api/v1` API.

## Install
1. Copy `modules/servers/myrdphub/` into your WHMCS root: `<whmcs>/modules/servers/myrdphub/`.
2. WHMCS → **Setup → Products/Services → Servers → Add New Server**:
   - **Hostname** = panel API base URL, e.g. `https://panel.myrdphub.com`
   - **Password** = a **reseller API key** (`rk_live_…`) with scopes `vm:read,vm:write,vm:reinstall,vm:delete`
   - Click **Test Connection** (calls `GET /api/v1/vms`).
3. Create a Product (**Setup → Products/Services**), set **Module Settings → Module = myrdphub**, choose the
   server group, and fill Config Options (product slug, OS template id, region).

## Create a reseller API key (on the panel host)
```
pnpm tsx scripts/create-api-key.ts --name "WHMCS reseller" --type reseller \
  --scopes vm:read,vm:write,vm:reinstall,vm:delete
```
Copy the printed `apiKey` into the WHMCS server **Password** field (shown once).

## Hook → API mapping
| WHMCS hook | API call | Status |
|---|---|---|
| TestConnection | `GET /api/v1/vms` | ✅ implemented |
| SuspendAccount | `POST /api/v1/vms/{id}/power {stop}` | ✅ implemented |
| UnsuspendAccount | `POST /api/v1/vms/{id}/power {start}` | ✅ implemented |
| Reboot | `POST /api/v1/vms/{id}/power {reboot}` | ✅ implemented |
| CreateAccount | `POST /api/v1/vms` | ⏳ endpoint TODO (provision) |
| TerminateAccount | `DELETE /api/v1/vms/{id}` | ⏳ endpoint TODO |
| Reinstall | `POST /api/v1/vms/{id}/reinstall` | ⏳ endpoint TODO |

> The `⏳` endpoints are the next `/api/v1` increment (thin wrappers over existing panel libs
> `enqueueProvisioningJob` / `enqueueReinstallJob` / `requestVmDeletion`).

## Deploy note
The `ApiKey` model is new — run a Prisma migration / `prisma db push` at deploy so the `api_keys` table exists
before creating keys.
