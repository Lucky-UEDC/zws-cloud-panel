import crypto from "node:crypto"

export type ParsedSshPublicKey = {
  type: "ssh-ed25519" | "ssh-rsa"
  publicKey: string
  fingerprint: string
  comment?: string
}

const PRIVATE_KEY_MARKERS = [
  "-----BEGIN OPENSSH PRIVATE KEY-----",
  "-----BEGIN RSA PRIVATE KEY-----",
  "-----BEGIN DSA PRIVATE KEY-----",
  "-----BEGIN EC PRIVATE KEY-----",
  "-----BEGIN PRIVATE KEY-----",
]

function readString(buffer: Buffer, offset: number) {
  if (offset + 4 > buffer.length) throw new Error("Invalid SSH public key payload.")
  const length = buffer.readUInt32BE(offset)
  const start = offset + 4
  const end = start + length
  if (length <= 0 || end > buffer.length) throw new Error("Invalid SSH public key payload.")
  return { value: buffer.subarray(start, end).toString("utf8"), offset: end }
}

export function parseSshPublicKey(input: unknown): ParsedSshPublicKey {
  const raw = String(input || "").trim().replace(/\r?\n/g, " ")
  if (!raw) throw new Error("SSH public key is required.")
  if (PRIVATE_KEY_MARKERS.some((marker) => raw.includes(marker))) {
    throw new Error("Private keys are not accepted. Paste an SSH public key only.")
  }

  const parts = raw.split(/\s+/)
  const type = parts[0] as ParsedSshPublicKey["type"]
  if (type !== "ssh-ed25519" && type !== "ssh-rsa") {
    throw new Error("Only ssh-ed25519 and ssh-rsa public keys are supported.")
  }
  if (!parts[1] || !/^[A-Za-z0-9+/]+={0,2}$/.test(parts[1])) {
    throw new Error("SSH public key payload is not valid base64.")
  }

  const decoded = Buffer.from(parts[1], "base64")
  if (!decoded.length || decoded.toString("base64").replace(/=+$/, "") !== parts[1].replace(/=+$/, "")) {
    throw new Error("SSH public key payload is not valid base64.")
  }

  const parsedType = readString(decoded, 0).value
  if (parsedType !== type) {
    throw new Error("SSH public key type does not match its payload.")
  }

  const fingerprint = crypto.createHash("sha256").update(decoded).digest("base64").replace(/=+$/, "")
  return {
    type,
    publicKey: `${type} ${parts[1]}${parts.slice(2).length ? ` ${parts.slice(2).join(" ")}` : ""}`,
    fingerprint: `SHA256:${fingerprint}`,
    comment: parts.slice(2).join(" ") || undefined,
  }
}

export function accessMethodLabel(method: string | null | undefined, keyLabel?: string | null) {
  switch (method) {
    case "SAVED_SSH_KEY":
      return keyLabel ? `SSH key "${keyLabel}"` : "Saved SSH key"
    case "GENERATED_SSH_KEY":
      return "New generated SSH key"
    case "PASTED_SSH_KEY":
      return "One-time pasted SSH key"
    default:
      return "Password login"
  }
}
