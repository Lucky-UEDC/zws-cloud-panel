# MyRDPHub Panel — Security Audit (2026-07-02)

Read-only audit of the panel's security posture: rate limiting, brute-force, CSRF, XSS, headers, DDoS.
**Overall: the panel is already well-hardened.** This is a *close-the-gaps + configure-the-edge* effort, not a rebuild.

## Summary scorecard

| Area | Status | Evidence |
|---|---|---|
| Login brute-force | ✅ Strong | `lib/auth-rate-limit.ts` — per-IP 20/hr + per-account lockout (DB `failedAttempt`) |
| CAPTCHA on auth | ✅ | Turnstile on login/register/forgot-password (`lib/security/turnstile.ts`) |
| Session cookies | ✅ Strong | `lib/auth/session-cookies.ts` — `httpOnly` + `secure`(prod) + `sameSite:strict` |
| CSRF | ✅ | SameSite=strict cookies + CSP `form-action 'self' …` |
| Security headers | ✅ | `next.config` — CSP, HSTS, `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `object-src 'none'` |
| Abuse logging / IP+device block | ✅ | `BlockedIp`/`BlockedDevice` models, `lib/security/abuse.ts`, `login-security.ts` |
| General per-route API rate limit | ⚠️ Partial | `lib/security/rate-limit.ts` `checkSecurityRateLimit` gated behind Cloudflare-enabled setting |
| Edge DDoS / WAF | ⚠️ External | Must be Cloudflare (L3/4 + rate rules) — not app-solvable |
| XSS sinks | ⚠️ Review | 19 `dangerouslySetInnerHTML` — mostly SEO JSON-LD/CMS; verify blog content sanitization |
| Edge middleware | ⚠️ Missing | No `middleware.ts` (headers come from next.config, which is fine) |

## What's already solid (no action)
- **Brute-force:** `checkLoginRateLimit` (auth-rate-limit.ts:33) enforces both a per-IP cap (20 fails/hour, IP_RATE_LIMIT_MAX_ATTEMPTS) and a per-account lockout (`security.maxLoginAttempts` default 5 within `lockoutDurationMinutes`). `markLoginResult` clears on success, records on failure.
- **Cookies/CSRF:** `sameSite:strict` + `httpOnly` + `secure` means session cookies aren't sent cross-site and aren't JS-readable — strong CSRF and token-theft protection. CSP `form-action` restricts POST targets.
- **CSP:** `default-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`, allowlisted `connect-src`/`script-src`/`frame-src` for payment SDKs + Cloudflare Turnstile.

## Prioritized recommendations (defense-in-depth)

### P1 — Cloudflare edge (the real DDoS/XSS/bruteforce shield the request is about)
DDoS is not app-solvable; put the panel behind Cloudflare and enable:
- **WAF** managed ruleset (OWASP) + **Bot Fight Mode**.
- **Rate-limiting rules**: e.g. `/api/auth/*` 10 req/min/IP; `/api/*` 100 req/min/IP; `/api/client/vps/*/reinstall` 3/hour/IP.
- **Turnstile** already wired — keep enforced on auth.
- Then flip the app's `isCloudflareRateLimitEnabled` setting ON so `checkSecurityRateLimit` also enforces app-side.
- HTTP DDoS protection + "Under Attack" mode available for incidents.

### P2 — App-level per-route rate limiting on sensitive mutations (fallback if edge bypassed)
Reuse `checkSecurityRateLimit` (lib/security/rate-limit.ts) on: VM power/reinstall/delete routes, payment create,
invoice mutations, order create. Make it enforce even when the Cloudflare-gated flag is off (add an
`alwaysEnforce` path for these high-impact routes), so a direct-to-origin attacker can't spam VM operations.

### P3 — XSS sink review
Audit the 19 `dangerouslySetInnerHTML`. Most are SEO JSON-LD / static marketing / recharts (safe). The one to
verify is `app/blog/[slug]/page.tsx` — if blog HTML is admin-authored via a trusted CMS it's low-risk; if any
user-influenced field is rendered, run it through a sanitizer (DOMPurify/sanitize-html). `components/admin/email-console.tsx`
is admin-only preview (low risk).

### P4 — Optional `middleware.ts`
Add a thin `middleware.ts` to (a) attach security headers uniformly (belt-and-suspenders vs next.config),
(b) add a lightweight per-IP request counter for `/api/*` as origin-side backstop, (c) block obviously bad
bots/paths early. Keep it minimal to avoid latency.

## DDoS/XSS/brute-force answer (direct)
- **DDoS**: Cloudflare (edge) — app cannot absorb L3/4 volumetric attacks. Config in P1.
- **Brute-force**: already handled app-side (P-none) + Cloudflare rate rules (P1).
- **XSS**: strong CSP + httpOnly cookies already mitigate; verify blog sanitization (P3).
- **CSRF**: already handled (SameSite=strict).
- **Rate limits**: login covered; extend to sensitive mutations (P2) + Cloudflare (P1).

## Next steps
P2 + P4 are code (I can implement on a `feat/security-hardening` branch). P1 is Cloudflare dashboard config
(ops) — documented here + will be in the docs site. P3 needs a decision on whether blog content is trusted.
