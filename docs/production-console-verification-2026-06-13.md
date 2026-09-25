# Production Console Verification - 2026-06-13

## Summary

Final modernization rollout completed against production on 2026-06-13 UTC.

- Production source: `/var/www/myrdphub`
- Rollback snapshot: `/var/backups/myrdphub/production/20260613-195327`
- Candidate source: `/var/tmp/myrdphub-candidate-final-20260613-194413`
- Repository target: `samvpslio/myrdphub-platform`

## Deployment State

- Fresh no-Git candidate build completed in `/var/tmp`.
- Candidate chunk smoke passed: 2 CSS chunks and 1524 JS chunks from build artifacts.
- Candidate route crawler passed with 28 routes checked.
- Candidate route smoke covered `/health`, `/api/health`, `/api/runtime/config`, `/admin/backups`, `/api/admin/backups`, and console overview/session pages.
- Candidate was promoted into `/var/www/myrdphub`.
- Rollback `.next`, production source archive, PM2 state, nginx state, environment backup, and database dump were stored outside the source root.

## Production Health

Post-promotion checks:

| Check | Result |
| --- | --- |
| `http://127.0.0.1:3000/health` | 200 |
| `http://127.0.0.1:3000/api/health` | 200 |
| `http://127.0.0.1:3001/health` | 200 |
| `https://myrdphub.com/health` | 200 |
| `https://myrdphub.com/api/health` | 200 |
| nginx validation | passed |
| enabled nginx site | `myrdphub` only |
| `.git` directories under production root | 1 |
| `.next` directories under production root | 1 |
| `current` symlink / `releases` directory | absent |

PM2 contains exactly one instance of each required process, all with cwd `/var/www/myrdphub`:

- `zws-web`
- `zws-worker`
- `zws-whatsapp`
- `zws-vnc-proxy`

## Automated Verification

| Command | Result |
| --- | --- |
| `pnpm typecheck` | passed |
| `pnpm lint` | passed with 6 existing `<img>` warnings |
| `pnpm test` | passed, 23 tests |
| `bash -n updater/update.sh installer/install.sh` | passed |
| `PLAYWRIGHT_SKIP_WEBSERVER=1 PLAYWRIGHT_BASE_URL=https://myrdphub.com pnpm exec playwright test console-modernization.spec.ts --project=chromium` | passed, 3 tests |
| `pnpm db:check` | passed |
| `pnpm db:validate:migrations` | passed |
| `pnpm audit:db-integrity` | dry run only, findings below |
| `pnpm console:validate:vnc -- --vmid 129 --timeout-ms 45000` | passed |
| `pnpm console:validate:serial -- --vmid 146 --timeout-ms 45000` | passed |
| `pnpm console:validate:serial -- --vmid 144 --timeout-ms 45000` | known guest-specific failure, 4404 |

## Console Validators

### Windows VM 129

- Mode: noVNC
- Framebuffer: visible at 1024 x 768
- Keyboard/mouse validation: input changed framebuffer
- Resize request: sent
- Ctrl+Alt+Del: sent
- Result: passed

### Linux VM 146

- Mode: xterm.js serial
- Serial authentication: passed
- Output received: yes
- `echo TEST123`: returned
- `uname -a`: returned
- Result: passed

### Linux VM 144

- Mode: xterm.js serial
- Proxy opened the websocket but closed before serial validation completed.
- Close code/message: `4404`, `Unknown error`
- Result: recorded as guest-specific non-blocker.

## Bundled Chrome Verification

Bundled Chrome executable:

`/root/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome`

Verified against `https://myrdphub.com`:

- Windows desktop noVNC first load reached `vnc - visible`.
- Windows reconnect minted a different websocket token and returned to `vnc - visible`.
- Screenshot capture enabled the separate download action.
- Fullscreen control was exercised and captured.
- Clipboard paste reported `Clipboard pasted into VM`.
- Linux mobile xterm reached `serial - visible`.

Token evidence:

- Initial VNC token hash: `60682f5af9ce`
- Reconnect VNC token hash: `548ce7cbbd5b`
- Token changed: yes

## Screenshots

Sanitized production screenshots:

- [Windows desktop noVNC](./screenshots/console-windows-desktop.png)
- [Windows fullscreen noVNC](./screenshots/console-windows-fullscreen.png)
- [Linux mobile serial](./screenshots/console-linux-mobile.png)

Screenshot dimensions:

- `console-windows-desktop.png`: 1440 x 1000
- `console-windows-fullscreen.png`: 1440 x 1000
- `console-linux-mobile.png`: 390 x 844

## Database Integrity Audit

Dry run only. No auto-repair was applied.

Findings:

- `paid_service_invoices_deleted_orders`: 2
- `network_event_spam`: 12
- `whatsapp_evolution_configured`: 3

All other audited categories returned 0. The full audit document remains at:

- [DB integrity audit](./db-integrity-audit-2026-06-13.md)

## Known Non-Blockers

- VM 144 serial remains a guest-specific `4404` failure and was not used as the passing Linux target.
- `pnpm lint` reports 6 existing `<img>` warnings and no errors.
- Candidate standalone `/api/health` reported degraded because the candidate process was intentionally not part of the live PM2 topology; production `/api/health` returns 200.
- Redis reports a recommendation for version 6.2.0 or newer; production is currently on 6.0.16.
- The noVNC dependency still emits the known top-level-await build warning during production build.
