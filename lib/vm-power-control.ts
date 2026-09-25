import type { createProxmoxClient } from "@/lib/proxmox"

type ProxmoxClient = ReturnType<typeof createProxmoxClient>

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Poll until the VM reports stopped (or is gone). Returns true if stopped. */
export async function waitForVmStopped(client: ProxmoxClient, node: string, vmid: number, timeoutMs = 60_000, pollMs = 2_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const runtime = await client.getVMStatus(node, vmid).catch(() => null)
    const status = String((runtime as any)?.status || "").toLowerCase()
    if (!runtime || status === "stopped") return true
    if (Date.now() >= deadline) return false
    await sleep(pollMs)
  }
}

/**
 * Stop a VM as reliably as possible, keyed only by VMID:
 *   (optional graceful shutdown) -> stop+skiplock -> unlock+stop+skiplock -> node-level QEMU kill -> final check.
 * The final observed VM state is authoritative; stale intermediate errors are never surfaced as a synthetic exhaustion code.
 */
export async function robustlyStopVm(input: {
  client: ProxmoxClient
  node: string
  vmid: number
  graceful?: boolean
  gracefulTimeoutMs?: number
  sshUsername?: string | null
}): Promise<{ stopped: boolean; via: string }> {
  const { client, node, vmid } = input

  if (await waitForVmStopped(client, node, vmid, 0)) return { stopped: true, via: "already_stopped" }

  // Tier 0: graceful ACPI shutdown (opt-in — reinstall/delete skip this to save time).
  if (input.graceful) {
    await client.shutdownVM(node, vmid).catch(() => null)
    if (await waitForVmStopped(client, node, vmid, input.gracefulTimeoutMs ?? 60_000)) return { stopped: true, via: "graceful" }
  }

  // Tier 1: force stop with skiplock.
  await client.stopVM(node, vmid, { skiplock: true }).catch(() => null)
  // API tokens may have VM.PowerMgmt while Proxmox reserves skiplock for the
  // root user itself. Retry the same VMID without the privileged flag.
  await client.stopVM(node, vmid).catch(() => null)
  if (await waitForVmStopped(client, node, vmid, 15_000)) return { stopped: true, via: "stop" }

  // Tier 2: clear any config lock, then force stop again.
  await (client as any).unlockVM?.(node, vmid)?.catch?.(() => null)
  await client.stopVM(node, vmid, { skiplock: true }).catch(() => null)
  if (await waitForVmStopped(client, node, vmid, 15_000)) return { stopped: true, via: "unlock_stop" }

  // Tier 3: kill the QEMU process on the node (needs Sys.Console; best-effort).
  await client.execNodeCommand(node, `pid=$(cat /var/run/qemu-server/${vmid}.pid 2>/dev/null); test -n "$pid" && kill -9 "$pid" || true`).catch(() => null)
  await sleep(3_000)
  if (await waitForVmStopped(client, node, vmid, 12_000)) return { stopped: true, via: "kill" }

  // Final truth check — never claim failure if it is actually stopped now.
  const stopped = await waitForVmStopped(client, node, vmid, 0)
  return { stopped, via: stopped ? "final_check" : "exhausted" }
}

/** Reboot a VM by VMID: guest reboot, falling back to a hard reset if that fails/unsupported. */
export async function robustlyRebootVm(input: { client: ProxmoxClient; node: string; vmid: number }): Promise<{ via: string }> {
  try {
    await input.client.rebootVM(input.node, input.vmid)
    return { via: "reboot" }
  } catch {
    await input.client.resetVM(input.node, input.vmid)
    return { via: "reset" }
  }
}
