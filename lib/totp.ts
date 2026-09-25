import crypto from 'crypto'

const STEP_SECONDS = 30
const DIGITS = 6
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

function normalizeBase32(value: string) {
  return value.replace(/=+$/g, '').replace(/\s+/g, '').toUpperCase()
}

export function generateBase32Secret(length = 32) {
  const bytes = crypto.randomBytes(length)
  let output = ''
  for (let i = 0; i < bytes.length; i += 1) {
    output += BASE32_ALPHABET[bytes[i] % BASE32_ALPHABET.length]
  }
  return output
}

export function decodeBase32(secret: string) {
  const normalized = normalizeBase32(secret)
  let bits = ''
  for (const char of normalized) {
    const index = BASE32_ALPHABET.indexOf(char)
    if (index === -1) {
      throw new Error('Invalid base32 secret')
    }
    bits += index.toString(2).padStart(5, '0')
  }

  const bytes: number[] = []
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(Number.parseInt(bits.slice(i, i + 8), 2))
  }
  return Buffer.from(bytes)
}

function hotp(secret: string, counter: number) {
  const key = decodeBase32(secret)
  const buffer = Buffer.alloc(8)
  buffer.writeBigUInt64BE(BigInt(counter))
  const digest = crypto.createHmac('sha1', key).update(buffer).digest()
  const offset = digest[digest.length - 1] & 0x0f
  const code =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff)
  return String(code % 10 ** DIGITS).padStart(DIGITS, '0')
}

export function generateTotp(secret: string, timestamp = Date.now()) {
  const counter = Math.floor(timestamp / 1000 / STEP_SECONDS)
  return hotp(secret, counter)
}

export function verifyTotp(secret: string, token: string, window = 1) {
  const normalizedToken = token.replace(/\s+/g, '')
  if (!/^\d{6}$/.test(normalizedToken)) {
    return false
  }
  const counter = Math.floor(Date.now() / 1000 / STEP_SECONDS)
  for (let offset = -window; offset <= window; offset += 1) {
    if (hotp(secret, counter + offset) === normalizedToken) {
      return true
    }
  }
  return false
}

export function buildOtpAuthUri({
  secret,
  accountName,
  issuer,
}: {
  secret: string
  accountName: string
  issuer: string
}) {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(accountName)}?secret=${encodeURIComponent(secret)}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`
}

export function buildQrCodeUrl(otpauthUri: string) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(otpauthUri)}`
}

export function generateBackupCodes(count = 8) {
  return Array.from({ length: count }, () => crypto.randomBytes(4).toString('hex').toUpperCase())
}
