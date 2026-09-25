const HANDLERS_INSTALLED = Symbol.for("zws.process_error_handlers_installed")

type ProcessWithZwsHandlers = typeof process & {
  [HANDLERS_INSTALLED]?: boolean
}

function serializeReason(reason: unknown) {
  if (reason instanceof Error) {
    return {
      name: reason.name,
      message: reason.message,
      stack: reason.stack || null,
    }
  }

  return {
    name: "NonError",
    message: typeof reason === "string" ? reason : safeStringify(reason),
    stack: null,
  }
}

function safeStringify(value: unknown) {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function isBenignHttpAbort(error: unknown) {
  if (!(error instanceof Error)) return false
  const code = String((error as Error & { code?: unknown }).code || "")
  return code === "ECONNRESET" && /aborted/i.test(error.message)
}

export function registerNodeProcessErrorHandlers() {
  const runtimeProcess = process as ProcessWithZwsHandlers
  if (runtimeProcess[HANDLERS_INSTALLED]) return
  runtimeProcess[HANDLERS_INSTALLED] = true

  process.on("uncaughtException", (error) => {
    if (isBenignHttpAbort(error)) return
    console.error("[SSR] uncaught_exception", serializeReason(error))
  })

  process.on("unhandledRejection", (reason) => {
    console.error("[SSR] unhandled_rejection", serializeReason(reason))
  })
}
