# VM Provisioning Acceptance Runbook

Run this after deploying provisioning or addon purchase changes. Do not mark the VM platform production-ready until every check passes on real infrastructure.

## Windows 2022 Purchase

- Purchase a Windows Server 2022 VM for customer `LuckyMishra`.
- Confirm one paid order has one provisioning job and one VM service.
- In Proxmox, verify the cloned VM has a fresh `net0` MAC that does not match the template.
- Verify Cloudbase-Init config includes `ciuser=Administrator`, `cipassword`, `ipconfig0`, gateway, DNS, and `citype=configdrive2`.
- Verify the database IP assignment, VM network cache, and Proxmox `ipconfig0` agree on the primary IP.
- Confirm QEMU guest agent is online and reports the assigned IP.
- Confirm TCP reachability on port `3389`.
- Confirm order status is `active` and provisioning status is `ACTIVE` only after the checks above pass.

## Ubuntu 22.04 Purchase

- Purchase an Ubuntu 22.04 VM.
- Confirm one paid order has one provisioning job and one VM service.
- In Proxmox, verify the cloned VM has a fresh `net0` MAC that does not match the template.
- Verify cloud-init config includes `ciuser`, `cipassword`, `ipconfig0`, gateway, DNS, search domain, and a cloud-init drive.
- Verify `qm cloudinit dump user` and `qm cloudinit dump network` contain the expected hostname, user, password config, IP, gateway, DNS, and search domain.
- Verify the database IP assignment, VM network cache, and Proxmox `ipconfig0` agree on the primary IP.
- Confirm QEMU guest agent is online and reports the assigned IP.
- Confirm TCP reachability on port `22`.
- Confirm order status is `active` and provisioning status is `ACTIVE` only after the checks above pass.

## Addon Purchases

- Double-click or retry the same addon purchase request and confirm only one pending invoice is created.
- Start the same addon purchase with a different idempotency key while the first invoice is pending and confirm the existing invoice is returned.
- Buy an additional IPv4 address only after selecting an eligible priced IP pool.
- Confirm the additional IP writes canonical assignment, legacy assignment, IP history, VM IP history, and VM network cache rows.
- Buy bandwidth, snapshot, and backup addons and confirm each creates one invoice, one active purchase, and one entitlement visible on the VM page.
