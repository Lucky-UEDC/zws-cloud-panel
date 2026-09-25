export async function readRawBody(request: Request) {
  return request.text()
}

export function parseVerifiedJson<T = any>(rawBody: string): T {
  return JSON.parse(rawBody) as T
}
