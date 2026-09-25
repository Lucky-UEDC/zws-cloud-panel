export function safeJson<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, currentValue: unknown) => {
      if (currentValue === undefined) {
        return null
      }

      if (typeof currentValue === "bigint") {
        const asNumber = Number(currentValue)
        return Number.isSafeInteger(asNumber) ? asNumber : currentValue.toString()
      }

      if (currentValue instanceof Date) {
        return currentValue.toISOString()
      }

      if (
        currentValue &&
        typeof currentValue === "object" &&
        "toNumber" in currentValue &&
        typeof (currentValue as { toNumber: unknown }).toNumber === "function"
      ) {
        return (currentValue as { toNumber: () => number }).toNumber()
      }

      return currentValue
    }),
  ) as T
}
