import { decryptVaultSecret, encryptVaultSecret } from "@/lib/crypto/secret-vault"

export type GatewayCredentials = Record<string, unknown>

export function encryptGatewayCredentials(credentials: GatewayCredentials | null | undefined) {
  const text = JSON.stringify(credentials || {})
  if (text === "{}") {
    return { credentialsEnc: null, credentialsIv: null, credentialsTag: null }
  }
  const encrypted = encryptVaultSecret(text)
  return {
    credentialsEnc: encrypted.ciphertext,
    credentialsIv: encrypted.iv,
    credentialsTag: encrypted.tag,
  }
}

export function decryptGatewayCredentials(input: {
  credentialsEnc?: string | null
  credentialsIv?: string | null
  credentialsTag?: string | null
}) {
  if (!input.credentialsEnc || !input.credentialsIv || !input.credentialsTag) return {}
  return JSON.parse(decryptVaultSecret({
    ciphertext: input.credentialsEnc,
    iv: input.credentialsIv,
    tag: input.credentialsTag,
  })) as GatewayCredentials
}

export function maskGatewayCredentials(input: {
  credentialsEnc?: string | null
  credentialsIv?: string | null
  credentialsTag?: string | null
}) {
  if (!input.credentialsEnc || !input.credentialsIv || !input.credentialsTag) return {}
  const credentials = decryptGatewayCredentials(input)
  return Object.fromEntries(Object.keys(credentials).map((key) => [key, credentials[key] ? "••••••••" : ""]))
}
