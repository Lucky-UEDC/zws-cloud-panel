export type RfbClientFrameClass =
  | "set_pixel_format"
  | "set_encodings"
  | "framebuffer_request"
  | "key_event"
  | "pointer_event"
  | "client_cut_text"
  | "set_desktop_size"
  | "unknown"
  | "partial"

export function classifyRfbClientFrame(input: Uint8Array | Buffer): { kind: RfbClientFrameClass; length: number; keyDown?: boolean; buttonMask?: number; width?: number; height?: number } {
  const frame = Buffer.from(input)
  if (frame.length < 1) return { kind: "partial", length: frame.length }
  const type = frame[0]
  if (type === 0) return { kind: frame.length >= 20 ? "set_pixel_format" : "partial", length: frame.length }
  if (type === 2) {
    if (frame.length < 4) return { kind: "partial", length: frame.length }
    const encodings = frame.readUInt16BE(2)
    return { kind: frame.length >= 4 + encodings * 4 ? "set_encodings" : "partial", length: frame.length }
  }
  if (type === 3) {
    if (frame.length < 10) return { kind: "partial", length: frame.length }
    return { kind: "framebuffer_request", length: frame.length, width: frame.readUInt16BE(6), height: frame.readUInt16BE(8) }
  }
  if (type === 4) return { kind: frame.length >= 8 ? "key_event" : "partial", length: frame.length, keyDown: Boolean(frame[1]) }
  if (type === 5) return { kind: frame.length >= 6 ? "pointer_event" : "partial", length: frame.length, buttonMask: frame[1] }
  if (type === 6) {
    if (frame.length < 8) return { kind: "partial", length: frame.length }
    const textLength = frame.readUInt32BE(4)
    return { kind: frame.length >= 8 + textLength ? "client_cut_text" : "partial", length: frame.length }
  }
  if (type === 251) {
    if (frame.length < 20) return { kind: "partial", length: frame.length }
    return { kind: "set_desktop_size", length: frame.length, width: frame.readUInt16BE(2), height: frame.readUInt16BE(4) }
  }
  return { kind: "unknown", length: frame.length }
}
