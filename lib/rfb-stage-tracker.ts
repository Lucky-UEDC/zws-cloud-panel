export type RfbStage =
  | "protocol"
  | "security_types"
  | "challenge"
  | "security_result"
  | "server_init"
  | "framebuffer"

export type RfbStageEvent = {
  stage: RfbStage | "first_framebuffer" | "first_non_empty_framebuffer"
  width?: number
  height?: number
  rects?: number
  nonZeroSampleBytes?: number
  encoding?: number
  message?: string
}

export type RfbStageSnapshot = {
  stage: RfbStage
  width: number
  height: number
  firstFramebuffer: boolean
  firstNonEmptyFramebuffer: boolean
}

function sampleBytes(frame: Buffer) {
  const step = Math.max(1, Math.floor(frame.length / 65536))
  let nonZero = 0
  for (let index = 0; index < frame.length; index += step) {
    if (frame[index] !== 0) nonZero += 1
  }
  return nonZero
}

export class RfbStageTracker {
  private buffer = Buffer.alloc(0)
  private stage: RfbStage = "protocol"
  private width = 0
  private height = 0
  private bpp = 4
  private firstFramebuffer = false
  private firstNonEmptyFramebuffer = false

  snapshot(): RfbStageSnapshot {
    return {
      stage: this.stage,
      width: this.width,
      height: this.height,
      firstFramebuffer: this.firstFramebuffer,
      firstNonEmptyFramebuffer: this.firstNonEmptyFramebuffer,
    }
  }

  push(frame: Buffer): RfbStageEvent[] {
    this.buffer = Buffer.concat([this.buffer, frame])
    const events: RfbStageEvent[] = []

    while (true) {
      if (this.stage === "protocol") {
        if (this.buffer.length < 12) break
        const version = this.buffer.subarray(0, 12).toString("ascii")
        this.buffer = this.buffer.subarray(12)
        if (!version.startsWith("RFB")) {
          events.push({ stage: "protocol", message: "RFB protocol header missing" })
          break
        }
        this.stage = "security_types"
        events.push({ stage: "protocol", message: version.trim() })
      } else if (this.stage === "security_types") {
        if (this.buffer.length < 1) break
        const count = this.buffer[0]
        if (this.buffer.length < 1 + count) break
        this.buffer = this.buffer.subarray(1 + count)
        this.stage = "challenge"
        events.push({ stage: "security_types" })
      } else if (this.stage === "challenge") {
        if (this.buffer.length < 16) break
        this.buffer = this.buffer.subarray(16)
        this.stage = "security_result"
        events.push({ stage: "challenge" })
      } else if (this.stage === "security_result") {
        if (this.buffer.length < 4) break
        const status = this.buffer.readUInt32BE(0)
        this.buffer = this.buffer.subarray(4)
        this.stage = "server_init"
        events.push({ stage: "security_result", message: status === 0 ? "ok" : `failed:${status}` })
      } else if (this.stage === "server_init") {
        if (this.buffer.length < 24) break
        this.width = this.buffer.readUInt16BE(0)
        this.height = this.buffer.readUInt16BE(2)
        this.bpp = Math.max(1, Math.floor(this.buffer[4] / 8))
        const nameLength = this.buffer.readUInt32BE(20)
        if (this.buffer.length < 24 + nameLength) break
        this.buffer = this.buffer.subarray(24 + nameLength)
        this.stage = "framebuffer"
        events.push({ stage: "server_init", width: this.width, height: this.height })
      } else if (this.stage === "framebuffer") {
        if (this.buffer.length < 4) break
        if (this.buffer[0] !== 0) {
          this.buffer = this.buffer.subarray(1)
          continue
        }
        const rects = this.buffer.readUInt16BE(2)
        let offset = 4
        let nonZeroSampleBytes = 0
        let unsupportedEncoding: number | null = null
        for (let index = 0; index < rects; index += 1) {
          if (this.buffer.length < offset + 12) return events
          const rectWidth = this.buffer.readUInt16BE(offset + 4)
          const rectHeight = this.buffer.readUInt16BE(offset + 6)
          const encoding = this.buffer.readInt32BE(offset + 8)
          offset += 12
          if (encoding !== 0) {
            unsupportedEncoding = encoding
            break
          }
          const length = rectWidth * rectHeight * this.bpp
          if (this.buffer.length < offset + length) return events
          nonZeroSampleBytes += sampleBytes(this.buffer.subarray(offset, offset + length))
          offset += length
        }
        if (unsupportedEncoding !== null) {
          events.push({ stage: "first_framebuffer", encoding: unsupportedEncoding, message: "Non-raw framebuffer encoding observed" })
          this.buffer = Buffer.alloc(0)
          break
        }
        this.buffer = this.buffer.subarray(offset)
        if (!this.firstFramebuffer) {
          this.firstFramebuffer = true
          events.push({ stage: "first_framebuffer", width: this.width, height: this.height, rects, nonZeroSampleBytes })
        }
        if (!this.firstNonEmptyFramebuffer && nonZeroSampleBytes > 0) {
          this.firstNonEmptyFramebuffer = true
          events.push({ stage: "first_non_empty_framebuffer", width: this.width, height: this.height, rects, nonZeroSampleBytes })
        }
      }
    }

    return events
  }
}
