/**
 * Is the QEMU guest agent channel open on this VM or template?
 *
 * Proxmox does not store the agent flag as the integer `1`. It stores the QGA
 * option string, so a template that has fstrim-on-clone enabled reads:
 *
 *     agent=1,fstrim_cloned_disks=1
 *
 * `Number("1,fstrim_cloned_disks=1")` is `NaN`. A check written as
 * `Number(value) === 1` therefore reports the channel **closed** for every VM
 * that has any other agent option set — which is most of them.
 *
 * That is not a cosmetic misreading. The flag gates whether provisioning treats
 * a template as configurable at all, so the check decided that working,
 * agent-enabled images were unconfigurable, and reported the ones with no extra
 * options as the only usable templates. It also made the QA script's catalogue
 * listing contradict what the hypervisor actually said about the same VM.
 *
 * One definition, no dependencies, so the server routes, the admin UI and the QA
 * script cannot disagree about it.
 */

/** Parse the leading integer of a Proxmox option-list value. */
function leadingInteger(value: unknown): number | null {
  const text = String(value ?? "").trim()
  if (!text) return null
  const match = text.match(/^\s*(-?\d+)/)
  return match ? Number(match[1]) : null
}

export function guestAgentChannelOpen(config: Record<string, unknown> | null | undefined): boolean {
  if (!config || typeof config !== "object") return false
  return Object.entries(config).some(
    ([key, value]) => /^agent(\d+)?$/i.test(key) && leadingInteger(value) === 1,
  )
}

/**
 * The agent flag exactly as Proxmox stores it, for callers that need to write it
 * without discarding other options already on the flag.
 */
export function readAgentFlag(config: Record<string, unknown> | null | undefined): string | null {
  if (!config || typeof config !== "object") return null
  for (const [key, value] of Object.entries(config)) {
    if (/^agent(\d+)?$/i.test(key)) return String(value ?? "")
  }
  return null
}
