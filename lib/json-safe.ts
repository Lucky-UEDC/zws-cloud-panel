export function toJsonable<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value ?? null, (_key: string, entry: unknown) => (typeof entry === "bigint" ? Number(entry) : entry)),
  )
}