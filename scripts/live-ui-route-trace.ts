import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

type Trace = {
  area: string
  summaryArea?: string
  browserUrl: string
  page: string
  sidebar: string
  apis: string[]
  services: string[]
  models: string[]
}

const today = new Date().toISOString().slice(0, 10)
const traces: Trace[] = [
  {
    area: "Dashboard",
    browserUrl: "/admin",
    page: "app/admin/page.tsx",
    sidebar: "Dashboard",
    apis: ["/api/admin/dashboard", "/api/admin/revenue"],
    services: ["lib/admin-dashboard.ts", "lib/revenue-analytics.ts"],
    models: ["Order", "Invoice", "Payment", "VpsInstance", "Customer", "CouponRedemption"],
  },
  {
    area: "Customers",
    browserUrl: "/admin/customers, /admin/customers/[id]",
    page: "app/admin/customers/page.tsx, app/admin/customers/[id]/page.tsx",
    sidebar: "Customers > Customers",
    apis: ["/api/admin/customers", "/api/admin/customers/[id]"],
    services: ["lib/revenue-analytics.ts", "lib/checkout-identity.ts"],
    models: ["Customer", "Order", "Invoice", "Payment", "WalletTransaction", "SupportTicket"],
  },
  {
    area: "Orders",
    browserUrl: "/admin/orders, /admin/orders/new",
    page: "app/admin/orders/page.tsx, app/admin/orders/new/page.tsx",
    sidebar: "Customers > Orders",
    apis: ["/api/admin/orders/with-vm-status", "/api/admin/orders/[id]", "/api/admin/orders/bulk"],
    services: ["lib/vps-lifecycle.ts", "lib/provision.ts", "lib/revenue-analytics.ts"],
    models: ["Order", "Invoice", "Payment", "VpsInstance", "ProvisioningJob", "IpAllocation"],
  },
  {
    area: "Invoices",
    browserUrl: "/admin/invoices",
    page: "app/admin/invoices/page.tsx",
    sidebar: "Payments > Invoices",
    apis: ["/api/admin/invoices", "/api/admin/invoices/[id]", "/api/admin/invoices/bulk"],
    services: ["lib/invoice-deletion.ts", "lib/invoices.ts", "lib/revenue-analytics.ts"],
    models: ["Invoice", "Payment", "PaymentAttempt", "PaymentGatewayAttempt", "Order"],
  },
  {
    area: "Revenue",
    browserUrl: "/admin/revenue",
    page: "app/admin/revenue/page.tsx",
    sidebar: "Payments > Revenue",
    apis: ["/api/admin/revenue"],
    services: ["lib/revenue-analytics.ts"],
    models: ["Invoice", "Payment", "Order", "VpsInstance", "DedicatedService", "CouponRedemption"],
  },
  {
    area: "Coupons",
    browserUrl: "/admin/coupons, /admin/coupons/[id]",
    page: "app/admin/coupons/page.tsx, app/admin/coupons/[id]/page.tsx",
    sidebar: "Products & Sales > Coupons",
    apis: ["/api/admin/coupons", "/api/admin/coupons/[id]"],
    services: ["lib/coupons.ts"],
    models: ["Coupon", "CouponRedemption", "Product", "ProductGroup"],
  },
  {
    area: "Virtual Machines",
    summaryArea: "VMs",
    browserUrl: "/admin/vms, /admin/vms/[id]",
    page: "app/admin/vms/page.tsx, app/admin/vms/[id]/page.tsx",
    sidebar: "Infrastructure > Virtual Machines",
    apis: ["/api/admin/vms", "/api/admin/vms/[id]", "/api/admin/vms/[id]/network", "/api/admin/vms/[id]/delete"],
    services: ["lib/admin-vm-management.ts", "lib/vm-deletion.ts", "lib/vm-network-orchestrator.ts"],
    models: ["VpsInstance", "Order", "ProxmoxNode", "VmNetworkInterface", "VmIpAssignment", "VmNetworkEvent", "IpAllocation"],
  },
  {
    area: "Console",
    browserUrl: "/admin/vms/[id]/console",
    page: "app/admin/vms/[id]/console/page.tsx",
    sidebar: "Virtual Machines row/detail action",
    apis: ["/api/admin/vms/[id]/console/session", "/api/admin/vms/[id]/console/resize", "/api/admin/vms/[id]/console/ctrl-alt-del"],
    services: ["lib/console-session.ts", "lib/console-mode.ts", "lib/console-resolution.ts", "lib/proxmox-vnc.ts"],
    models: ["VpsInstance", "Order", "OsTemplate", "ProxmoxNode"],
  },
  {
    area: "Operating Systems",
    summaryArea: "Templates",
    browserUrl: "/admin/os-templates",
    page: "app/admin/os-templates/page.tsx",
    sidebar: "Infrastructure > Operating Systems",
    apis: ["/api/admin/os-templates", "/api/admin/os-templates/[id]", "/api/admin/os-templates/sync"],
    services: ["lib/os-template-availability.ts", "lib/os-template-normalization.ts"],
    models: ["OsTemplate", "ProxmoxNode"],
  },
  {
    area: "IP Pools",
    browserUrl: "/admin/ip-pools, /admin/ip-pools/[id]",
    page: "app/admin/ip-pools/page.tsx, app/admin/ip-pools/[id]/page.tsx",
    sidebar: "Infrastructure > IP Pools",
    apis: ["/api/admin/ip-pools", "/api/admin/ip-pools/[id]", "/api/admin/ip-pools/[id]/allocations"],
    services: ["lib/ip-pool.ts", "lib/ipam-admin.ts", "lib/vm-network-orchestrator.ts"],
    models: ["IpPool", "IpPoolRange", "IpAllocation", "VmIpAssignment", "VmNetworkInterface", "VmNetworkEvent"],
  },
  {
    area: "Backups",
    browserUrl: "/admin/backups",
    page: "app/admin/backups/page.tsx",
    sidebar: "System > Backups",
    apis: ["/api/admin/backups", "/api/admin/backups/upload", "/api/admin/backups/[id]/restore", "/api/admin/backups/[id]/restore-test"],
    services: ["lib/backups.ts", "lib/backup-health.ts", "lib/google-drive-backup.ts"],
    models: ["BackupRun", "BackupDestination", "BackupRestoreTest", "RuntimeIntegration"],
  },
  {
    area: "Notifications",
    browserUrl: "/admin/notifications, /admin/notifications/logs",
    page: "app/admin/notifications/page.tsx, app/admin/notifications/logs/page.tsx",
    sidebar: "Communication > Notifications",
    apis: ["/api/admin/notifications/settings", "/api/admin/notifications/logs"],
    services: ["lib/notifications/service.ts", "lib/email/send.ts", "lib/whatsapp/send.ts"],
    models: ["NotificationDeliveryLog", "EmailLog", "WhatsAppMessageLog", "CustomerNotificationPreference"],
  },
  {
    area: "WhatsApp",
    browserUrl: "/admin/whatsapp",
    page: "app/admin/whatsapp/page.tsx",
    sidebar: "Communication > WhatsApp",
    apis: ["/api/admin/whatsapp/status", "/api/admin/whatsapp/health", "/api/admin/whatsapp/send", "/api/admin/whatsapp/test-message"],
    services: ["lib/whatsapp/evolution.ts", "lib/whatsapp/send.ts", "lib/whatsapp/queue.ts"],
    models: ["RuntimeIntegration", "WhatsAppMessageLog", "WhatsAppCampaign", "WhatsAppCampaignLog"],
  },
]

function row(trace: Trace) {
  return [
    `## ${trace.area}`,
    "",
    `- Browser URL: \`${trace.browserUrl}\``,
    `- Page component: \`${trace.page}\``,
    `- Sidebar entry: ${trace.sidebar}`,
    `- API calls: ${trace.apis.map((item) => `\`${item}\``).join(", ")}`,
    `- Service functions/files: ${trace.services.map((item) => `\`${item}\``).join(", ")}`,
    `- DB models: ${trace.models.map((item) => `\`${item}\``).join(", ")}`,
    "",
  ].join("\n")
}

function tableCell(value: string) {
  return value.replaceAll("|", "\\|")
}

function summaryRow(trace: Trace) {
  return `| ${tableCell(trace.summaryArea || trace.area)} | \`${tableCell(trace.browserUrl)}\` | \`${tableCell(trace.page)}\` | ${tableCell(trace.sidebar)} | ${trace.apis.map((item) => `\`${tableCell(item)}\``).join(", ")} | ${trace.services.map((item) => `\`${tableCell(item)}\``).join(", ")} | ${trace.models.map((item) => `\`${tableCell(item)}\``).join(", ")} |`
}

async function main() {
  const outDir = path.join(process.cwd(), "docs")
  await mkdir(outDir, { recursive: true })
  const file = path.join(outDir, `live-ui-route-trace-${today}.md`)
  const body = [
    `# MYRDPHUB Live UI Route Trace - ${today}`,
    "",
    "This report maps each live admin surface to its page, navigation entry, API calls, service layer, and database models.",
    "",
    "Production PM2 apps serve `/var/www/myrdphub`; deploys update the single production codebase only after backup and validation.",
    "",
    "| Surface | Browser URL | Page component | Sidebar entry | API calls | Service functions/files | DB models |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...traces.map(summaryRow),
    "",
    ...traces.map(row),
  ].join("\n")
  await writeFile(file, body)
  console.log(file)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
