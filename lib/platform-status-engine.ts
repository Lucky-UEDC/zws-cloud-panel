export type PaymentHealthStatus = "paid" | "pending" | "failed" | "reconciled"
export type ProvisioningHealthStatus = "queued" | "provisioning" | "failed" | "active"
export type NetworkHealthStatus = "healthy" | "mismatch" | "repairing"
export type VmHealthStatus = "running" | "stopped" | "locked" | "suspended"
export type OrderHealthStatus = "healthy" | "attention" | "critical"

export type NormalizedPlatformStatus = {
  payment: PaymentHealthStatus
  provisioning: ProvisioningHealthStatus
  network: NetworkHealthStatus
  vm: VmHealthStatus
  orderHealth: OrderHealthStatus
}

function norm(value: unknown) {
  return String(value || "").trim().toLowerCase()
}

export function normalizePaymentStatus(input: {
  paymentStatus?: string | null
  orderStatus?: string | null
}) : PaymentHealthStatus {
  const payment = norm(input.paymentStatus)
  const order = norm(input.orderStatus)

  if (["failed", "cancelled", "canceled", "payment_failed", "error", "expired"].includes(payment)) return "failed"
  if (["verification_pending", "reconciled"].includes(payment)) return "reconciled"
  if (["completed", "paid", "success"].includes(payment)) return "paid"

  if (["paid", "active", "completed", "payment_verified"].includes(order)) return "paid"
  if (["failed", "cancelled", "canceled", "payment_failed", "expired"].includes(order)) return "failed"

  return "pending"
}

export function normalizeProvisioningStatus(input: {
  provisioningStatus?: string | null
  jobStatus?: string | null
  vmStatus?: string | null
}) : ProvisioningHealthStatus {
  const provisioning = norm(input.provisioningStatus)
  const job = norm(input.jobStatus)
  const vm = norm(input.vmStatus)

  if (["failed", "error", "start_failed", "provision_failed", "upgrade_failed"].includes(provisioning)) return "failed"
  if (["failed", "error"].includes(job)) return "failed"

  if (["active", "completed", "provisioned"].includes(provisioning)) return "active"
  if (["running", "active"].includes(vm) && ["", "pending"].includes(provisioning)) return "active"

  if (["queued", "pending", "waiting_for_admin", "upgrade_queued"].includes(provisioning)) return "queued"
  if (["queued", "pending"].includes(job)) return "queued"

  if (
    [
      "cloning_template",
      "resizing_disk",
      "assigning_ip",
      "applying_cloud_init",
      "starting_vm",
      "verifying_vm",
      "provisioning",
      "running",
      "reinstalling",
      "updating_config",
    ].includes(provisioning)
  ) {
    return "provisioning"
  }
  if (["running"].includes(job)) return "provisioning"

  return "queued"
}

export function normalizeNetworkStatus(input: {
  networkIssues?: string[] | null
  networkEventStatus?: string | null
  vmIpAddress?: string | null
  primaryAssignedIp?: string | null
}) : NetworkHealthStatus {
  const issues = Array.isArray(input.networkIssues) ? input.networkIssues : []
  const eventStatus = norm(input.networkEventStatus)

  if (["running", "repairing", "queued"].includes(eventStatus)) return "repairing"
  if (issues.length > 0) return "mismatch"

  const vmIp = String(input.vmIpAddress || "").trim()
  const primaryIp = String(input.primaryAssignedIp || "").trim()
  if (vmIp && primaryIp && vmIp !== primaryIp) return "mismatch"

  return "healthy"
}

export function normalizeVmStatus(input: {
  vmStatus?: string | null
  orderProvisioningStatus?: string | null
}) : VmHealthStatus {
  const vm = norm(input.vmStatus)
  const provisioning = norm(input.orderProvisioningStatus)

  if (["suspended", "suspend", "disabled"].includes(vm)) return "suspended"
  if (["locked", "lock", "waiting_for_admin"].includes(vm) || provisioning === "waiting_for_admin") return "locked"
  if (["active", "running", "started", "online"].includes(vm)) return "running"

  return "stopped"
}

export function calculateOrderHealth(input: {
  payment: PaymentHealthStatus
  provisioning: ProvisioningHealthStatus
  network: NetworkHealthStatus
  vm: VmHealthStatus
}) : OrderHealthStatus {
  // Deterministic priority: payment/provisioning failures outrank all, then VM/network risk, then pending progress.
  if (input.payment === "failed" || input.provisioning === "failed") return "critical"
  if (input.vm === "locked" || input.vm === "suspended" || input.network === "mismatch") return "attention"
  if (input.payment === "pending" || input.provisioning === "queued" || input.provisioning === "provisioning" || input.network === "repairing") return "attention"
  return "healthy"
}

export function computeNormalizedPlatformStatus(input: {
  paymentStatus?: string | null
  orderStatus?: string | null
  provisioningStatus?: string | null
  jobStatus?: string | null
  vmStatus?: string | null
  networkIssues?: string[] | null
  networkEventStatus?: string | null
  vmIpAddress?: string | null
  primaryAssignedIp?: string | null
}) : NormalizedPlatformStatus {
  const payment = normalizePaymentStatus({ paymentStatus: input.paymentStatus, orderStatus: input.orderStatus })
  const provisioning = normalizeProvisioningStatus({
    provisioningStatus: input.provisioningStatus,
    jobStatus: input.jobStatus,
    vmStatus: input.vmStatus,
  })
  const network = normalizeNetworkStatus({
    networkIssues: input.networkIssues,
    networkEventStatus: input.networkEventStatus,
    vmIpAddress: input.vmIpAddress,
    primaryAssignedIp: input.primaryAssignedIp,
  })
  const vm = normalizeVmStatus({ vmStatus: input.vmStatus, orderProvisioningStatus: input.provisioningStatus })
  const orderHealth = calculateOrderHealth({ payment, provisioning, network, vm })

  return { payment, provisioning, network, vm, orderHealth }
}
