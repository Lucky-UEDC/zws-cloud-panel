# Admin Guide

## Admin Modules

- Dashboard, analytics, revenue, logs, and audit views.
- Customers, orders, invoices, wallet adjustments, and email verification overrides.
- Products, offers, dedicated servers, OS templates, storage pools, compute nodes, IP pools, and provisioning controls.
- Domains and domain gateway settings for Cashfree, PhonePe, fallback routing, and approved payment domains.
- Email module for SMTP, templates, previews, sends, and logs.

## Payment Operations

- Keep gateway credentials in Admin -> Domains and gateway configuration screens.
- Settings -> Payment is an overview surface and should not become a duplicate credential editor.
- Use payment attempts, webhook logs, and status reconciliation before manually marking records paid.
- Pending invoices and pending gateway payments must not count as paid revenue.
- Paid invoices/orders should be archived or soft-deleted only when safe; do not hard-delete paid records.

## VPS Operations

- New VPS orders are provisioned only after payment finalization.
- CPU/RAM upgrade orders now use the same paid flow as checkout.
- Disk upgrades use `/client-area/vps/[id]/upgrade/disk` and can resize, move, or add disks.
- Reinstall uses shared OS availability, preserves assigned IP, and handles Windows without Linux-only assumptions.
- Failed provisioning should be retried from admin actions after checking task logs and Proxmox reachability.

## Email Operations

- Use Admin -> Email for SMTP and template workflows.
- Routine business email should fail open and log failures.
- SMTP tests should show exact safe failure codes where possible.

## Security Operations

- Logout should happen only from explicit logout actions.
- Do not use navigation, API 401s, Redis misses, or checkout errors as logout triggers.
- Keep host-only cookies and same-origin protections intact.
- Never expose secret values in logs, API responses, screenshots, or docs.
