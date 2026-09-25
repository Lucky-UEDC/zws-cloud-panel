export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerNodeProcessErrorHandlers } = await import("./instrumentation-node")
    registerNodeProcessErrorHandlers()
  }
}
